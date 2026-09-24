// Content script 入口：响应 popup 发来的指令。
// 依赖（按 manifest 中的顺序加载）: shared/*, state.js, dom-text.js, dom-apply.js,
// page-ui.js, translation-queue.js, translator.js

// 脚本可能被 popup 重复注入，监听器只注册一次
if (!window.__aiTranslateListenerRegistered) {
  window.__aiTranslateListenerRegistered = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'ping':
        // 用于探测content script是否存在，避免消息发送失败
        sendResponse({ status: 'pong' });
        break;

      case 'translate':
        aiTranslate.currentTargetLang = message.targetLang;
        // 立即响应，翻译在后台异步进行（进度通过 sendProgressMessage 广播）
        sendResponse({ status: 'started' });
        setTimeout(() => {
          startTranslation(message.targetLang).catch(error => {
            console.error('[AI翻译] 翻译过程中出错:', error);
            sendProgressMessage('translationError', null, error.message);
          });
        }, 0);
        break;

      case 'stopTranslation':
        stopTranslation();
        sendResponse({ status: 'stopped' });
        break;

      case 'toggleLanguage':
        toggleLanguage();
        sendResponse({ status: 'toggled', isTranslated: aiTranslate.isTranslated });
        break;

      case 'checkTranslationStatus':
        sendResponse({
          isTranslated: aiTranslate.isTranslated,
          currentTargetLang: aiTranslate.currentTargetLang
        });
        break;

      default:
        // 其他消息（如广播给 popup 的进度）不属于这里
        return false;
    }
    return false;
  });
}
