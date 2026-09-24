// 扩展弹窗：选择目标语言、开始/停止翻译、切换原文与译文
// 依赖: shared/constants.js, shared/storage.js, shared/i18n.js

const POPUP_AUTO_CLOSE_DELAY_MS = 800;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// 确保content script已注入到目标标签页，再发送消息
// 修复 "Could not establish connection. Receiving end does not exist." 错误
function ensureContentScript(tabId) {
  return new Promise((resolve) => {
    // 先发送探测消息，确认content script是否已存在
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
      if (!chrome.runtime.lastError && response) {
        resolve();
        return;
      }

      // 不存在（如扩展安装前已打开的页面）则按 manifest 中的文件列表程序化注入
      const files = chrome.runtime.getManifest().content_scripts[0].js;
      chrome.scripting.executeScript({ target: { tabId }, files }, () => {
        if (chrome.runtime.lastError) {
          console.error('注入content script错误:', chrome.runtime.lastError);
        }
        // 等待content script初始化完成
        setTimeout(resolve, 100);
      });
    });
  });
}

// 向标签页的 content script 发送消息；通信失败时 reject
async function sendToContentScript(tabId, message) {
  await ensureContentScript(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const translateButton = document.getElementById('translatePage');
  const toggleLanguageButton = document.getElementById('toggleLanguage');
  const stopButton = document.getElementById('stopTranslation');
  const targetLangSelect = document.getElementById('targetLang');
  const statusMessage = document.getElementById('statusMessage');
  const progressIndicator = document.getElementById('progressIndicator');
  const openOptionsButton = document.getElementById('openOptions');
  const apiStatusElement = document.getElementById('apiStatus');

  function updateStatus(message, progress) {
    statusMessage.textContent = message;
    progressIndicator.style.width = `${progress}%`;
    progressIndicator.style.display = progress > 0 ? 'block' : 'none';
  }

  async function showError(error) {
    console.error('[AI翻译]', error);
    updateStatus(await getI18nMessage('error', error.message), 0);
  }

  async function showToggleButton(isTranslated) {
    toggleLanguageButton.style.display = 'block';
    if (isTranslated) {
      toggleLanguageButton.textContent = await getI18nMessage('viewOriginal');
      toggleLanguageButton.title = '点击查看原始语言';
    } else {
      toggleLanguageButton.textContent = await getI18nMessage('viewTranslation');
      toggleLanguageButton.title = '点击查看翻译';
    }
  }

  // 返回可运行翻译的当前标签页；不可用时显示错误并返回 null
  async function getTranslatableTab({ silent = false } = {}) {
    const tab = await getActiveTab();
    if (!tab) {
      if (!silent) updateStatus(await getI18nMessage('cannotGetTab'), 0);
      return null;
    }
    if (isRestrictedUrl(tab.url)) {
      if (!silent) updateStatus(await getI18nMessage('cannotRunOnPage'), 0);
      return null;
    }
    return tab;
  }

  async function checkApiConfiguration() {
    const config = await syncGet(['apiBaseUrl', 'apiModel', 'apiKey']);
    if (isApiConfigComplete(config)) {
      apiStatusElement.textContent = await getI18nMessage('apiConfigured');
      apiStatusElement.className = 'connected';
      translateButton.disabled = false;
    } else {
      apiStatusElement.textContent = await getI18nMessage('apiNotConfigured');
      apiStatusElement.className = 'error';
      translateButton.disabled = true;
      updateStatus(await getI18nMessage('configureApiFirst'), 0);
    }
  }

  // 页面已翻译或曾选择过目标语言时显示切换按钮
  async function checkTranslationStatus() {
    try {
      const tab = await getTranslatableTab({ silent: true });
      if (!tab) return;
      const response = await sendToContentScript(tab.id, { action: 'checkTranslationStatus' });
      if (response?.isTranslated || response?.currentTargetLang) {
        await showToggleButton(response.isTranslated);
      }
    } catch (error) {
      console.error('检查翻译状态错误:', error);
    }
  }

  translateButton.addEventListener('click', async () => {
    const targetLang = targetLangSelect.value;
    syncSet({ targetLanguage: targetLang }).catch(() => {});
    updateStatus(await getI18nMessage('translating'), 10);

    try {
      const tab = await getTranslatableTab();
      if (!tab) return;

      const response = await sendToContentScript(tab.id, { action: 'translate', targetLang });
      if (response?.status === 'started') {
        updateStatus(await getI18nMessage('translationProgress', 50), 50);
        // 后台翻译：关闭弹窗后翻译继续，页面内进度条与扩展角标实时显示进度
        setTimeout(() => window.close(), POPUP_AUTO_CLOSE_DELAY_MS);
      }
    } catch (error) {
      await showError(error);
    }
  });

  stopButton.addEventListener('click', async () => {
    try {
      const tab = await getTranslatableTab();
      if (!tab) return;
      const response = await sendToContentScript(tab.id, { action: 'stopTranslation' });
      if (response?.status === 'stopped') {
        updateStatus(await getI18nMessage('translationStopped'), 0);
      }
    } catch (error) {
      console.error('[AI翻译] 停止翻译失败:', error);
    }
  });

  toggleLanguageButton.addEventListener('click', async () => {
    try {
      const tab = await getTranslatableTab();
      if (!tab) return;
      const response = await sendToContentScript(tab.id, { action: 'toggleLanguage' });
      if (response?.status === 'toggled') {
        await showToggleButton(response.isTranslated);
        if (response.isTranslated) {
          updateStatus(await getI18nMessage('switchedToTranslation'), 100);
        } else {
          updateStatus(await getI18nMessage('switchedToOriginal'), 0);
        }
      }
    } catch (error) {
      await showError(error);
    }
  });

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 监听 content script 广播的翻译进度
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const action = message.action || '';
    if (!action.startsWith('translation') && action !== 'summarizingPage') {
      return false;
    }

    (async () => {
      if (action === 'summarizingPage') {
        updateStatus(await getI18nMessage('analyzingPage'), 20);
      } else if (action === 'translationProgress') {
        updateStatus(await getI18nMessage('translationProgress', message.progress), message.progress);
      } else if (action === 'translationComplete') {
        updateStatus(await getI18nMessage('translationComplete'), 100);
        await showToggleButton(true);
        setTimeout(() => updateStatus('', 0), 30000);
      } else if (action === 'translationError') {
        updateStatus(await getI18nMessage('error', message.error), 0);
      }
    })();

    sendResponse({ received: true });
    return false;
  });

  // 初始化
  await translatePage();
  const { targetLanguage } = await syncGet(['targetLanguage']);
  if (targetLanguage) {
    targetLangSelect.value = targetLanguage;
  }
  await checkApiConfiguration();
  checkTranslationStatus();
});
