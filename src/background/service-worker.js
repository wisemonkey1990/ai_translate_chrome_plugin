// 后台 Service Worker：负责调用大模型 API，并用扩展图标角标展示翻译进度
importScripts(
  '../shared/constants.js',
  '../shared/storage.js',
  '../shared/i18n.js',
  'llm-client.js',
  'prompts.js'
);

const TRANSLATE_TIMEOUT_MS = 30000;
const SUMMARY_TIMEOUT_MS = 60000;
const BADGE_CLEAR_DELAY_MS = 4000;

const PROGRESS_ACTIONS = new Set([
  'summarizingPage',
  'translationProgress',
  'translationComplete',
  'translationError',
  'translationStopped'
]);

// 为 Promise 加超时，结束后清除计时器
function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 使用LLM API翻译文本
async function translateText(text, targetLang, pageSummary) {
  const config = await getApiConfig();
  const messages = buildTranslationMessages(config, text, targetLang, pageSummary);
  return requestChatCompletion(config, messages, config.temperature ?? DEFAULT_TEMPERATURE, 'Translation');
}

// 使用LLM API总结网页内容
async function summarizePageContent(content) {
  const config = await getApiConfig();
  return requestChatCompletion(config, buildSummaryMessages(content), DEFAULT_TEMPERATURE, 'Summary');
}

// 把异步任务结果按 { success, [resultKey]: value } / { success: false, error } 回传
function respondAsync(sendResponse, promise, resultKey, fallbackError) {
  promise
    .then(value => sendResponse({ success: true, [resultKey]: value }))
    .catch((error) => {
      console.error(`[AI翻译] ${fallbackError}:`, error);
      sendResponse({ success: false, error: error.message || fallbackError });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'translateText':
      if (!request.text || !request.targetLang) {
        sendResponse({ success: false, error: '翻译请求参数不完整' });
        return false;
      }
      respondAsync(
        sendResponse,
        withTimeout(translateText(request.text, request.targetLang, request.pageSummary), TRANSLATE_TIMEOUT_MS, '翻译请求超时'),
        'translatedText',
        '翻译过程中发生未知错误'
      );
      return true; // 保持消息通道开放，以便异步响应

    case 'summarizePageContent':
      if (!request.content) {
        sendResponse({ success: false, error: '网页内容总结请求参数不完整' });
        return false;
      }
      respondAsync(
        sendResponse,
        withTimeout(summarizePageContent(request.content), SUMMARY_TIMEOUT_MS, '网页内容总结请求超时'),
        'summary',
        '网页内容总结过程中发生未知错误'
      );
      return true;

    default:
      // 进度消息（content → popup 的广播）也会到达这里：用于更新角标，弹窗关闭后仍可见
      if (PROGRESS_ACTIONS.has(request.action)) {
        updateTranslationBadge(request);
        sendResponse({ received: true });
      }
      return false;
  }
});

// 根据翻译状态更新扩展图标角标
function updateTranslationBadge(request) {
  const setBadge = (text, color) => {
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
  };
  const clearBadgeLater = () => {
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), BADGE_CLEAR_DELAY_MS);
  };

  try {
    switch (request.action) {
      case 'summarizingPage':
        setBadge('…', '#4285f4');
        break;
      case 'translationProgress': {
        const pct = Math.min(100, Math.max(0, Math.round(request.progress || 0)));
        setBadge(pct + '%', '#4285f4');
        break;
      }
      case 'translationComplete':
        setBadge('✓', '#34a853');
        clearBadgeLater();
        break;
      case 'translationError':
      case 'translationStopped':
        setBadge('!', '#ea4335');
        clearBadgeLater();
        break;
    }
  } catch (error) {
    console.error('[AI翻译] 更新角标失败:', error);
  }
}
