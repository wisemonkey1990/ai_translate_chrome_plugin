// 自适应并发队列：信号量限流，每个条目处理完立即回调进度。
// 普通错误不降速；触发限流(429/5xx)时自动降并发并冷却，一段时间无限流后恢复满并发；
// 连续多次非限流错误则中止整个队列。与 DOM/chrome API 无关，便于单元测试。

const RATE_LIMIT_ERROR_RE = /429|rate\s*limit|too\s*many\s*requests|quota|insufficient_quota|502|503|504|overloaded|busy/i;

function isRateLimitError(error) {
  return RATE_LIMIT_ERROR_RE.test((error && error.message) || '');
}

/**
 * @param {Array} items 按处理优先级排好序的条目
 * @param {(item) => Promise} processItem 处理单个条目，抛错计为失败
 * @param {object} options
 *   isAborted: () => boolean       外部中止信号（如用户点击停止）
 *   onProgress: (done, total)      每个条目结束（成功或失败）后回调
 *   onRateLimited: (limit, error)  触发限流降并发时回调
 *   onItemError: (error)           非限流失败时回调
 * @returns {Promise<{completed, failed, firstError, failureAborted}>}
 */
async function runAdaptiveQueue(items, processItem, options = {}) {
  const {
    maxConcurrent: requestedConcurrency = 6,
    maxConsecutiveFailures = 5,
    minConcurrentOnRateLimit = 2,
    rateLimitRecoveryMs = 3000,
    initialBackoffMs = 1000,
    maxBackoffMs = 8000,
    pollIntervalMs = 120,
    isAborted = () => false,
    onProgress = () => {},
    onRateLimited = () => {},
    onItemError = () => {},
    now = Date.now,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = options;

  const total = items.length;
  const maxConcurrent = Math.min(requestedConcurrency, total);
  let activeLimit = maxConcurrent;
  let inflight = 0;
  let lastRateLimitAt = 0;
  let rateCooldownUntil = 0;
  let rateBackoffMs = initialBackoffMs;
  let nextIndex = 0;
  let consecutiveFailures = 0;
  let failureAborted = false;
  const result = { completed: 0, failed: 0, firstError: null, failureAborted: false };

  const stopped = () => failureAborted || isAborted();

  // 申请一个并发槽位；并发满或处于限流冷却期时等待
  async function waitForSlot() {
    for (;;) {
      if (stopped()) return false;
      // 连续一段时间无限流，则直接恢复满并发
      if (activeLimit < maxConcurrent && (now() - lastRateLimitAt) > rateLimitRecoveryMs) {
        activeLimit = maxConcurrent;
      }
      if (inflight < activeLimit && now() >= rateCooldownUntil) {
        return true;
      }
      await wait(pollIntervalMs);
    }
  }

  async function runItem(item) {
    try {
      await processItem(item);
      if (stopped()) return;
      result.completed++;
      consecutiveFailures = 0;
    } catch (error) {
      result.failed++;
      if (isRateLimitError(error)) {
        // 限流/服务不可用：降低并发 + 退避冷却，不计入“连续失败中止”逻辑
        activeLimit = Math.max(minConcurrentOnRateLimit, Math.ceil(activeLimit * 0.6));
        lastRateLimitAt = now();
        rateCooldownUntil = now() + rateBackoffMs;
        rateBackoffMs = Math.min(rateBackoffMs * 2, maxBackoffMs);
        onRateLimited(activeLimit, error);
      } else {
        consecutiveFailures++;
        if (!result.firstError) result.firstError = error;
        onItemError(error);
      }
    }

    if (stopped()) return;

    if (consecutiveFailures >= maxConsecutiveFailures) {
      failureAborted = true;
      result.failureAborted = true;
      return;
    }

    onProgress(result.completed + result.failed, total);
  }

  async function worker() {
    for (;;) {
      if (!(await waitForSlot())) return;
      const idx = nextIndex++;
      if (idx >= total) return;
      inflight++;
      try {
        await runItem(items[idx]);
      } finally {
        inflight--;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < maxConcurrent; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return result;
}
