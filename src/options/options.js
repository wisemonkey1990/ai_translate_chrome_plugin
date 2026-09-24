// 设置页：API 配置、翻译选项、系统提示词与翻译缓存管理
// 依赖: shared/constants.js, shared/storage.js, shared/i18n.js, shared/translation-cache.js

// 设置页管理的 chrome.storage.sync 配置项（界面语言单独处理，重置时保留）
const SETTINGS_KEYS = [
  'apiBaseUrl',
  'apiModel',
  'apiKey',
  'temperature',
  'preserveFormatting',
  'enablePageSummary',
  'debugMode',
  'systemPrompt',
  'translationCacheLimitMB'
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const interfaceLanguageSelect = $('interfaceLanguage');
  const apiConfigForm = $('apiConfigForm');
  const apiBaseUrlInput = $('apiBaseUrl');
  const apiModelInput = $('apiModel');
  const apiKeyInput = $('apiKey');
  const temperatureInput = $('temperature');
  const preserveFormattingCheckbox = $('preserveFormatting');
  const enablePageSummaryCheckbox = $('enablePageSummary');
  const debugModeCheckbox = $('debugMode');
  const systemPromptTextarea = $('systemPrompt');
  const resetPromptButton = $('resetPromptButton');
  const translationCacheLimitInput = $('translationCacheLimitMB');
  const clearTranslationCacheButton = $('clearTranslationCacheButton');
  const translationCacheUsage = $('translationCacheUsage');
  const testButton = $('testButton');
  const resetButton = $('resetButton');
  const statusMessage = $('statusMessage');

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    if (type) {
      statusMessage.classList.add(type);
    }
    // 成功或错误消息 3 秒后自动清除
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = 'status-message';
      }, 3000);
    }
  }

  async function refreshTranslationCacheUsage() {
    try {
      const bytes = await getTranslationCacheUsageBytes();
      const limit = Number(translationCacheLimitInput.value) || DEFAULT_CACHE_LIMIT_MB;
      translationCacheUsage.textContent = `当前占用: ${formatBytes(bytes)} / ${limit} MB`;
    } catch (error) {
      console.error('读取翻译缓存占用失败:', error);
      translationCacheUsage.textContent = '当前占用: 无法读取';
    }
  }

  function fillForm(settings) {
    apiBaseUrlInput.value = settings.apiBaseUrl || '';
    apiModelInput.value = settings.apiModel || '';
    apiKeyInput.value = settings.apiKey || '';
    // temperature 为 0 也是合法值，只有未设置时才留空
    temperatureInput.value = settings.temperature ?? '';
    preserveFormattingCheckbox.checked = Boolean(settings.preserveFormatting);
    enablePageSummaryCheckbox.checked = Boolean(settings.enablePageSummary);
    debugModeCheckbox.checked = Boolean(settings.debugMode);
    translationCacheLimitInput.value = settings.translationCacheLimitMB ?? DEFAULT_CACHE_LIMIT_MB;
  }

  async function loadSavedSettings() {
    const settings = await syncGet(['interfaceLanguage', ...SETTINGS_KEYS]);
    if (settings.interfaceLanguage) {
      interfaceLanguageSelect.value = settings.interfaceLanguage;
    }
    fillForm(settings);
    // 没有保存过系统提示词则显示默认值
    systemPromptTextarea.value = settings.systemPrompt || await getDefaultSystemPrompt();
  }

  async function saveSettings() {
    if (!apiBaseUrlInput.value || !apiModelInput.value || !apiKeyInput.value) {
      showStatus(await getI18nMessage('fillRequiredFields'), 'error');
      return;
    }
    try {
      new URL(apiBaseUrlInput.value);
    } catch (e) {
      showStatus(await getI18nMessage('enterValidUrl'), 'error');
      return;
    }
    const cacheLimitMB = Number(translationCacheLimitInput.value);
    if (!Number.isFinite(cacheLimitMB) || cacheLimitMB < MIN_CACHE_LIMIT_MB || cacheLimitMB > MAX_CACHE_LIMIT_MB) {
      showStatus(`缓存容量上限必须在 ${MIN_CACHE_LIMIT_MB}-${MAX_CACHE_LIMIT_MB} MB 之间`, 'error');
      return;
    }

    await syncSet({
      apiBaseUrl: apiBaseUrlInput.value,
      apiModel: apiModelInput.value,
      apiKey: apiKeyInput.value,
      temperature: temperatureInput.value !== '' ? parseFloat(temperatureInput.value) : null,
      preserveFormatting: preserveFormattingCheckbox.checked,
      enablePageSummary: enablePageSummaryCheckbox.checked,
      debugMode: debugModeCheckbox.checked,
      systemPrompt: systemPromptTextarea.value || await getDefaultSystemPrompt(),
      translationCacheLimitMB: cacheLimitMB
    });
    // 立即淘汰超出新上限的旧缓存
    await trimTranslationCache(cacheLimitMB * 1024 * 1024);
    showStatus(await getI18nMessage('settingsSaved'), 'success');
    refreshTranslationCacheUsage();
  }

  // 直接从设置页发起一次最小请求，验证 URL/模型/密钥是否可用
  async function testApiConnection() {
    if (!apiBaseUrlInput.value || !apiModelInput.value || !apiKeyInput.value) {
      showStatus(await getI18nMessage('fillApiConfig'), 'error');
      return;
    }
    showStatus(await getI18nMessage('testingConnection'), 'info');

    try {
      const response = await fetch(buildChatCompletionsUrl(apiBaseUrlInput.value), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKeyInput.value}`
        },
        body: JSON.stringify({
          model: apiModelInput.value,
          messages: [
            {
              role: 'user',
              content: "Hello, this is a test message. Please respond with 'API connection successful'."
            }
          ],
          max_tokens: 20
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        showStatus(await getI18nMessage('connectionSuccess'), 'success');
      } else {
        showStatus(await getI18nMessage('invalidResponse'), 'error');
      }
    } catch (error) {
      console.error('API测试错误:', error);
      showStatus(await getI18nMessage('connectionFailed', error.message), 'error');
    }
  }

  async function resetSettings() {
    // 注意：保留 interfaceLanguage
    await syncRemove([...SETTINGS_KEYS, 'targetLanguage']);
    fillForm({});
    systemPromptTextarea.value = await getDefaultSystemPrompt();
    showStatus(await getI18nMessage('settingsReset'), 'info');
  }

  // ---------- 事件绑定 ----------

  apiConfigForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings().catch(error => showStatus(error.message, 'error'));
  });

  testButton.addEventListener('click', () => {
    testApiConnection();
  });

  resetButton.addEventListener('click', async () => {
    if (confirm(await getI18nMessage('confirmReset'))) {
      resetSettings().catch(error => showStatus(error.message, 'error'));
    }
  });

  resetPromptButton.addEventListener('click', async () => {
    systemPromptTextarea.value = await getDefaultSystemPrompt();
    showStatus(await getI18nMessage('defaultPromptRestored'), 'info');
  });

  clearTranslationCacheButton.addEventListener('click', async () => {
    if (!confirm('确定要清空所有翻译缓存吗？这不会删除 API 配置。')) {
      return;
    }
    try {
      await clearTranslationCache();
      await refreshTranslationCacheUsage();
      showStatus('翻译缓存已清空', 'success');
    } catch (error) {
      console.error('清空翻译缓存失败:', error);
      showStatus('清空翻译缓存失败: ' + error.message, 'error');
    }
  });

  translationCacheLimitInput.addEventListener('change', () => {
    refreshTranslationCacheUsage();
  });

  interfaceLanguageSelect.addEventListener('change', async () => {
    const newLanguage = interfaceLanguageSelect.value;
    await syncSet({ interfaceLanguage: newLanguage });
    await translatePage();

    // 当前提示词仍是某种语言的默认值时，切换为新语言的默认提示词
    const { systemPrompt } = await syncGet(['systemPrompt']);
    if (!systemPrompt || isDefaultSystemPrompt(systemPrompt)) {
      systemPromptTextarea.value = getDefaultSystemPromptFor(newLanguage);
    }

    const message = newLanguage === 'zh-CN' ? '界面语言已更改为中文' : 'Interface language changed to English';
    showStatus(message, 'info');
  });

  // ---------- 初始化 ----------
  await translatePage();
  await loadSavedSettings();
  refreshTranslationCacheUsage();
});
