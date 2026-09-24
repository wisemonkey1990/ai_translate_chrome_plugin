// runAdaptiveQueue 单元测试：并发上限、限流降速、连续失败中止、外部中止
// 运行: node tests/translationQueue.test.js

const { loadScripts, createChecker } = require('./helpers/load-scripts');

const ctx = loadScripts(['src/content/translation-queue.js']);
const { check, finish } = createChecker();

// 虚拟时钟：wait 直接推进时间，避免真实等待
function fakeClock() {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += ms; } };
}

(async () => {
  // 1. 全部成功：并发不超过上限，进度回调覆盖所有条目
  {
    let inflight = 0;
    let peak = 0;
    const progress = [];
    const items = Array.from({ length: 20 }, (_, i) => i);
    const result = await ctx.runAdaptiveQueue(items, async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise(r => setImmediate(r));
      inflight--;
    }, { maxConcurrent: 4, onProgress: (done, total) => progress.push([done, total]), ...fakeClock() });
    check('全部成功计数正确', result.completed === 20 && result.failed === 0);
    check('并发不超过 maxConcurrent', peak <= 4 && peak > 1);
    check('每个条目回调一次进度', progress.length === 20 && progress[19][0] === 20 && progress[19][1] === 20);
  }

  // 2. 条目少于并发上限时不创建多余 worker
  {
    const result = await ctx.runAdaptiveQueue([1], async () => {}, fakeClock());
    check('单条目正常完成', result.completed === 1);
  }

  // 3. 空队列直接返回
  {
    const result = await ctx.runAdaptiveQueue([], async () => {}, fakeClock());
    check('空队列不报错', result.completed === 0 && result.failed === 0);
  }

  // 4. 连续 5 次非限流错误：中止并记录首个错误
  {
    let calls = 0;
    const result = await ctx.runAdaptiveQueue(Array.from({ length: 50 }, (_, i) => i), async () => {
      calls++;
      throw new Error('bad request ' + calls);
    }, { maxConcurrent: 1, ...fakeClock() });
    check('连续失败触发中止', result.failureAborted === true);
    check('中止后不再处理剩余条目', calls === 5);
    check('记录首个错误', result.firstError && result.firstError.message === 'bad request 1');
  }

  // 5. 限流错误：不计入连续失败，降低并发并回调
  {
    const limits = [];
    let calls = 0;
    const result = await ctx.runAdaptiveQueue(Array.from({ length: 10 }, (_, i) => i), async () => {
      calls++;
      if (calls <= 6) throw new Error('API错误 (429): rate limit');
    }, { maxConcurrent: 6, onRateLimited: (limit) => limits.push(limit), ...fakeClock() });
    check('限流错误不导致中止', result.failureAborted === false);
    check('限流失败计入 failed，但不设置 firstError', result.failed === 6 && result.firstError === null);
    check('其余条目成功', result.completed === 4);
    check('限流时并发下降且不低于 2', limits.length > 0 && limits.every(l => l >= 2 && l < 6));
  }

  // 6. 外部中止：处理中的条目不计为完成，也不再派发新条目
  {
    let aborted = false;
    let calls = 0;
    const result = await ctx.runAdaptiveQueue(Array.from({ length: 10 }, (_, i) => i), async () => {
      calls++;
      if (calls === 3) aborted = true;
    }, { maxConcurrent: 1, isAborted: () => aborted, ...fakeClock() });
    check('外部中止后停止派发', calls === 3);
    check('中止时正在处理的条目不计为完成', result.completed === 2);
  }

  // 7. isRateLimitError 识别常见限流/过载信息
  {
    check('识别 429', ctx.isRateLimitError(new Error('API错误 (429): x')));
    check('识别 503', ctx.isRateLimitError(new Error('API错误 (503): x')));
    check('识别 quota', ctx.isRateLimitError(new Error('insufficient_quota')));
    check('普通错误不是限流', !ctx.isRateLimitError(new Error('API错误 (400): bad')));
  }

  finish();
})();
