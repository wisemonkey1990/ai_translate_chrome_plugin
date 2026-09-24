// 翻译流程编排：提取文本 → 视口优先排序 → 自适应并发请求（带缓存/去重）→ 写回页面

const MAX_CONCURRENT_REQUESTS = 6;
const DEFAULT_CACHE_TRIM_DELAY_MS = 2000;

// chrome.runtime.sendMessage 的 Promise 封装：通信失败或 success=false 时 reject
function sendRuntimeRequest(message, resultKey, fallbackError) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`发送消息错误: ${chrome.runtime.lastError.message}`));
          return;
        }
        if (response && response.success) {
          resolve(response[resultKey]);
        } else {
          reject(new Error(response?.error || fallbackError));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

// 广播翻译进度（popup 更新状态，background 更新角标）
function sendProgressMessage(action, progress = null, error = null) {
  const message = { action };
  if (progress !== null) message.progress = progress;
  if (error !== null) message.error = error;

  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        console.error('[AI翻译] 发送进度消息错误:', chrome.runtime.lastError);
      }
    });
  } catch (err) {
    console.error('[AI翻译] 发送进度消息异常:', err);
  }
}

// 合并短时间内的多次缓存写入，只做一次容量整理（整理需要读取全部缓存，代价较高）
let cacheTrimTimer = null;
function scheduleCacheTrim(delayMs = DEFAULT_CACHE_TRIM_DELAY_MS) {
  if (cacheTrimTimer) return;
  cacheTrimTimer = setTimeout(() => {
    cacheTrimTimer = null;
    trimTranslationCache(aiTranslate.cacheLimitBytes).catch((error) => {
      debugLog('整理翻译缓存失败:', error);
    });
  }, delayMs);
}

// 请求翻译一段文本：优先命中跨会话缓存，未命中才调用 API，成功后写回缓存。
// pageSummary 通过 getSummary 回调在发请求时读取（总结可能在翻译途中才就绪）。
async function requestTranslationForText(text, targetLang, getSummary) {
  try {
    const cached = await readCachedTranslation(text, targetLang);
    if (cached !== null) return cached;
  } catch (error) {
    debugLog('读取翻译缓存失败，继续在线请求:', error);
  }

  const translation = await sendRuntimeRequest({
    action: 'translateText',
    text,
    targetLang,
    pageSummary: getSummary ? getSummary() : null
  }, 'translatedText', '翻译接口返回未知错误');

  try {
    await writeCachedTranslation(text, targetLang, translation);
    scheduleCacheTrim();
  } catch (error) {
    // 写缓存失败（如超出配额）可忽略，不影响本次翻译
  }

  return translation;
}

// 后台生成页面总结；失败不影响翻译
async function fetchPageSummary() {
  try {
    sendProgressMessage('summarizingPage');
    const pageContent = getPageContent();
    debugLog(`获取到网页内容，长度: ${pageContent.length}`);
    const summary = await sendRuntimeRequest(
      { action: 'summarizePageContent', content: pageContent },
      'summary',
      '网页内容总结失败'
    );
    debugLog('网页内容总结完成，后续翻译将携带上下文');
    return summary;
  } catch (error) {
    console.error('[AI翻译] 网页内容总结失败（不影响翻译）:', error);
    return null;
  }
}

// 开始翻译
async function startTranslation(targetLang) {
  // 如果已经在翻译中，先停止并等待之前的流程退出
  if (aiTranslate.isTranslating) {
    stopTranslation();
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  aiTranslate.isTranslating = true;
  aiTranslate.translationAborted = false;
  const startTime = Date.now();

  try {
    const config = await getApiConfig();
    aiTranslate.debugMode = config.debugMode;
    aiTranslate.cacheLimitBytes = await getTranslationCacheLimitBytes();
    debugLog(`开始翻译，目标语言: ${targetLang}`);

    // 如果页面已经被翻译，先恢复原始文本
    if (aiTranslate.isTranslated) {
      restoreOriginalText();
    }

    const textNodes = getTranslatableTextNodes();
    const units = buildTranslationUnits(textNodes);
    rememberOriginalTexts(units);
    aiTranslate.units = units;
    debugLog(`找到 ${textNodes.length} 个可翻译文本节点，合并为 ${units.length} 个翻译单元`);

    if (units.length === 0) {
      sendProgressMessage('translationComplete');
      return;
    }

    // 页面总结在后台并行：不阻塞翻译，就绪后自动用于后续单元的上下文
    let pageSummary = null;
    if (config.enablePageSummary) {
      fetchPageSummary().then(summary => { pageSummary = summary; });
    }

    // 相同原文在本次会话中只请求一次：并发单元复用同一个在途 Promise
    const dedupeInFlight = new Map();
    const translateOnce = (text) => {
      const key = text.trim();
      if (!dedupeInFlight.has(key)) {
        const pending = requestTranslationForText(text, targetLang, () => pageSummary)
          .catch((error) => {
            dedupeInFlight.delete(key); // 失败则移除，允许后续相同文本重试
            throw error;
          });
        dedupeInFlight.set(key, pending);
      }
      return dedupeInFlight.get(key);
    };

    const totalUnits = units.length;
    let lastBroadcastPct = -1;
    ensureProgressOverlay();
    updateProgressOverlay(`正在翻译 0/${totalUnits} (0%)`);

    const result = await runAdaptiveQueue(
      orderUnitsByViewport(units),
      async (unit) => {
        const translated = await translateOnce(unit.original);
        if (!aiTranslate.translationAborted) {
          applyTranslationToUnit(unit, translated, targetLang);
        }
      },
      {
        maxConcurrent: MAX_CONCURRENT_REQUESTS,
        isAborted: () => aiTranslate.translationAborted,
        onProgress: (doneCount, total) => {
          const pct = Math.round((doneCount / total) * 100);
          updateProgressOverlay(`正在翻译 ${doneCount}/${total} (${pct}%)`);
          // 按百分比节流广播，供弹窗/扩展角标实时刷新
          if (pct !== lastBroadcastPct) {
            lastBroadcastPct = pct;
            sendProgressMessage('translationProgress', pct);
          }
        },
        onRateLimited: (limit, error) => {
          if (aiTranslate.debugMode) console.warn(`[AI翻译] 触发限流，临时降并发至 ${limit}:`, error.message);
        },
        onItemError: (error) => {
          if (aiTranslate.debugMode) console.warn('[AI翻译] 单个翻译单元失败，已跳过:', error.message);
        }
      }
    );

    if (result.failureAborted) {
      aiTranslate.translationAborted = true;
    }
    finishTranslation(result);
    debugLog(`翻译结束，耗时: ${(Date.now() - startTime) / 1000}秒`);
  } catch (error) {
    console.error('[AI翻译] 翻译过程中出错:', error);
    sendProgressMessage('translationError', null, error.message);
  } finally {
    hideProgressOverlay();
    aiTranslate.isTranslating = false;
  }
}

// 收尾：无论完成、中止还是部分失败，尽量保留已完成的译文并给出反馈
function finishTranslation({ completed, firstError, failureAborted }) {
  const aborted = aiTranslate.translationAborted;
  const wasUserStopped = aborted && !firstError && !failureAborted;

  if (!aborted) {
    aiTranslate.isTranslated = true;
    createOrShowToggleButton();
    sendProgressMessage('translationComplete');
  } else if (completed > 0 && !wasUserStopped) {
    // 部分失败，已翻译的内容保留
    aiTranslate.isTranslated = true;
    createOrShowToggleButton();
    sendProgressMessage('translationError', null, firstError ? firstError.message : '翻译部分失败');
  } else if (firstError) {
    // 完全没有成功翻译任何单元
    aiTranslate.isTranslated = false;
    sendProgressMessage('translationError', null, firstError.message);
  } else {
    // 用户手动停止：保留已完成的翻译
    aiTranslate.isTranslated = completed > 0;
    if (completed > 0) {
      createOrShowToggleButton();
    }
  }
}

function stopTranslation() {
  aiTranslate.translationAborted = true;
  aiTranslate.isTranslating = false;
  debugLog('手动停止翻译');
}

// 在译文与原文之间切换；从未翻译过则按上次的目标语言重新翻译
function toggleLanguage() {
  if (aiTranslate.isTranslated) {
    restoreOriginalText();
  } else if (aiTranslate.translatedTexts.size > 0) {
    reapplyTranslation();
  } else if (aiTranslate.currentTargetLang) {
    startTranslation(aiTranslate.currentTargetLang);
  }
}
