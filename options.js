// 使用i18n.js中定义的默认系统提示词

document.addEventListener('DOMContentLoaded', async () => {
  // 获取DOM元素
  const interfaceLanguageSelect = document.getElementById('interfaceLanguage');
  const apiConfigForm = document.getElementById('apiConfigForm');
  const apiBaseUrlInput = document.getElementById('apiBaseUrl');
  const apiModelInput = document.getElementById('apiModel');
  const apiKeyInput = document.getElementById('apiKey');

  const temperatureInput = document.getElementById('temperature');
  const preserveFormattingCheckbox = document.getElementById('preserveFormatting');
  const debugModeCheckbox = document.getElementById('debugMode');
  const systemPromptTextarea = document.getElementById('systemPrompt');
  const resetPromptButton = document.getElementById('resetPromptButton');
  const translationCacheLimitInput = document.getElementById('translationCacheLimitMB');
  const clearTranslationCacheButton = document.getElementById('clearTranslationCacheButton');
  const translationCacheUsage = document.getElementById('translationCacheUsage');
  const saveButton = document.getElementById('saveButton');
  const testButton = document.getElementById('testButton');
  const resetButton = document.getElementById('resetButton');
  const statusMessage = document.getElementById('statusMessage');

  // 加载保存的设置
  loadSavedSettings();
  refreshTranslationCacheUsage();

  // 保存设置
  apiConfigForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings();
  });

  // 测试API连接
  testButton.addEventListener('click', () => {
    testApiConnection();
  });

  // 重置设置
  resetButton.addEventListener('click', async () => {
    const confirmMessage = await getI18nMessage('confirmReset');
    if (confirm(confirmMessage)) {
      resetSettings();
    }
  });
  
  // 重置系统提示词为默认值
  resetPromptButton.addEventListener('click', async () => {
    systemPromptTextarea.value = await getDefaultSystemPrompt();
    const message = await getI18nMessage('defaultPromptRestored');
    showStatus(message, 'info');
  });

  // 清空翻译缓存
  clearTranslationCacheButton.addEventListener('click', async () => {
    if (!confirm('确定要清空所有翻译缓存吗？这不会删除 API 配置。')) {
      return;
    }

    try {
      const allData = await getLocalStorage(null);
      const cacheKeys = Object.keys(allData).filter(key => key.startsWith('transCache:'));
      if (cacheKeys.length > 0) {
        await removeLocalStorage(cacheKeys);
      }
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
  
  // 界面语言变更事件
  interfaceLanguageSelect.addEventListener('change', async () => {
    const newLanguage = interfaceLanguageSelect.value;
    await chrome.storage.sync.set({ interfaceLanguage: newLanguage });
    
    // 重新翻译页面
    await translatePage();
    
    // 如果系统提示词是默认值，则更新为新语言的默认提示词
    chrome.storage.sync.get(['systemPrompt'], async (result) => {
      // 获取旧的默认提示词（两种语言的）
      const oldZhPrompt = DEFAULT_SYSTEM_PROMPTS['zh-CN'];
      const oldEnPrompt = DEFAULT_SYSTEM_PROMPTS['en'];
      
      // 如果当前提示词是默认提示词之一，则更新为新语言的默认提示词
      if (!result.systemPrompt || result.systemPrompt === oldZhPrompt || result.systemPrompt === oldEnPrompt) {
        const newDefaultPrompt = await getDefaultSystemPrompt();
        systemPromptTextarea.value = newDefaultPrompt;
      }
    });
    
    // 显示语言已更改的消息
    const message = newLanguage === 'zh-CN' ? '界面语言已更改为中文' : 'Interface language changed to English';
    showStatus(message, 'info');
  });

  // 加载保存的设置
  function loadSavedSettings() {
    chrome.storage.sync.get([
      'interfaceLanguage',
      'apiBaseUrl',
      'apiModel',
      'apiKey',

      'temperature',
      'preserveFormatting',
      'enablePageSummary',
      'debugMode',
      'systemPrompt',
      'translationCacheLimitMB'
    ], (result) => {
      // 设置界面语言
      if (result.interfaceLanguage) {
        interfaceLanguageSelect.value = result.interfaceLanguage;
      }
      
      if (result.apiBaseUrl) apiBaseUrlInput.value = result.apiBaseUrl;
      if (result.apiModel) apiModelInput.value = result.apiModel;
      if (result.apiKey) apiKeyInput.value = result.apiKey;

      if (result.temperature) temperatureInput.value = result.temperature;
      if (result.preserveFormatting) preserveFormattingCheckbox.checked = result.preserveFormatting;
      if (result.enablePageSummary !== undefined) document.getElementById('enablePageSummary').checked = result.enablePageSummary;
      if (result.debugMode) debugModeCheckbox.checked = result.debugMode;
      if (result.translationCacheLimitMB !== undefined) {
        translationCacheLimitInput.value = result.translationCacheLimitMB;
      }
      
      // 加载系统提示词，如果没有保存过则使用默认值
      if (result.systemPrompt) {
        systemPromptTextarea.value = result.systemPrompt;
      } else {
        getDefaultSystemPrompt().then(defaultPrompt => {
          systemPromptTextarea.value = defaultPrompt;
        });
      }

      refreshTranslationCacheUsage();
    });
  }

  // 保存设置
  async function saveSettings() {
    // 验证必填字段
    if (!apiBaseUrlInput.value || !apiModelInput.value || !apiKeyInput.value) {
      const message = await getI18nMessage('fillRequiredFields');
      showStatus(message, 'error');
      return;
    }

    // 验证URL格式
    try {
      new URL(apiBaseUrlInput.value);
    } catch (e) {
      const message = await getI18nMessage('enterValidUrl');
      showStatus(message, 'error');
      return;
    }

    const cacheLimitMB = Number(translationCacheLimitInput.value);
    if (!Number.isFinite(cacheLimitMB) || cacheLimitMB < 1 || cacheLimitMB > 10) {
      showStatus('缓存容量上限必须在 1-10 MB 之间', 'error');
      return;
    }

    // 保存设置到Chrome存储
    chrome.storage.sync.set({
      apiBaseUrl: apiBaseUrlInput.value,
      apiModel: apiModelInput.value,
      apiKey: apiKeyInput.value,

      temperature: temperatureInput.value ? parseFloat(temperatureInput.value) : null,
      preserveFormatting: preserveFormattingCheckbox.checked,
      enablePageSummary: document.getElementById('enablePageSummary').checked,
      debugMode: debugModeCheckbox.checked,
      systemPrompt: systemPromptTextarea.value || await getDefaultSystemPrompt(),
      translationCacheLimitMB: cacheLimitMB
    }, async () => {
      await trimTranslationCache(cacheLimitMB * 1024 * 1024);
      const message = await getI18nMessage('settingsSaved');
      showStatus(message, 'success');
      refreshTranslationCacheUsage();
    });
  }

  // 测试API连接
  async function testApiConnection() {
    // 验证必填字段
    if (!apiBaseUrlInput.value || !apiModelInput.value || !apiKeyInput.value) {
      const message = await getI18nMessage('fillApiConfig');
      showStatus(message, 'error');
      return;
    }

    const testingMessage = await getI18nMessage('testingConnection');
    showStatus(testingMessage, 'info');

    try {
      // 构建API请求
      const apiUrl = `${apiBaseUrlInput.value}/chat/completions`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKeyInput.value}`
        },
        body: JSON.stringify({
          model: apiModelInput.value,
          messages: [
            {
              role: "user",
              content: "Hello, this is a test message. Please respond with 'API connection successful'."
            }
          ],
          max_tokens: 20
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API错误: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        const successMessage = await getI18nMessage('connectionSuccess');
        showStatus(successMessage, 'success');
      } else {
        const invalidMessage = await getI18nMessage('invalidResponse');
        showStatus(invalidMessage, 'error');
      }
    } catch (error) {
      const failedMessage = await getI18nMessage('connectionFailed', error.message);
      showStatus(failedMessage, 'error');
      console.error('API测试错误:', error);
    }
  }

  // 重置设置
  async function resetSettings() {
    chrome.storage.sync.remove([
      'apiBaseUrl',
      'apiModel',
      'apiKey',

      'temperature',
      'preserveFormatting',
      'enablePageSummary',
      'debugMode',
      'targetLanguage',
      'systemPrompt',
      'translationCacheLimitMB'
      // 注意：不要删除interfaceLanguage设置
    ], async () => {
      // 清空表单
      apiBaseUrlInput.value = '';
      apiModelInput.value = '';
      apiKeyInput.value = '';

      temperatureInput.value = '';
      preserveFormattingCheckbox.checked = false;
      document.getElementById('enablePageSummary').checked = false;
      debugModeCheckbox.checked = false;
      translationCacheLimitInput.value = 8;
      systemPromptTextarea.value = await getDefaultSystemPrompt();
      
      const resetMessage = await getI18nMessage('settingsReset');
      showStatus(resetMessage, 'info');
    });
  }

  // 显示状态消息
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = 'status-message';
    
    if (type) {
      statusMessage.classList.add(type);
    }
    
    // 如果是成功或错误消息，3秒后自动清除
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = 'status-message';
      }, 3000);
    }
  }

  // 获取指定缓存占用的字节数
  function getLocalStorage(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result || {});
      });
    });
  }

  function removeLocalStorage(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  async function refreshTranslationCacheUsage() {
    try {
      const allData = await getLocalStorage(null);
      const cacheKeys = Object.keys(allData).filter(key => key.startsWith('transCache:'));
      const bytes = await getLocalStorageBytes(cacheKeys);
      const limit = Number(translationCacheLimitInput.value) || 8;
      translationCacheUsage.textContent = `当前占用: ${formatBytes(bytes)} / ${limit} MB`;
    } catch (error) {
      console.error('读取翻译缓存占用失败:', error);
      translationCacheUsage.textContent = '当前占用: 无法读取';
    }
  }

  function getLocalStorageBytes(keys) {
    if (keys.length === 0) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
      chrome.storage.local.getBytesInUse(keys, (amount) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(amount || 0);
      });
    });
  }

  // 保存容量设置时立即淘汰最旧缓存，避免旧数据继续占用超出上限的空间。
  async function trimTranslationCache(limitBytes) {
    const allData = await getLocalStorage(null);
    const cacheKeys = Object.keys(allData).filter(key => key.startsWith('transCache:'));
    let usage = await getLocalStorageBytes(cacheKeys);
    if (usage <= limitBytes) return;

    const entries = cacheKeys
      .map(key => ({ key, ts: Number(allData[key]?.ts) || 0 }))
      .sort((a, b) => a.ts - b.ts);

    for (const entry of entries) {
      if (usage <= limitBytes) break;
      await removeLocalStorage(entry.key);
      usage = await getLocalStorageBytes(cacheKeys.filter(key => key !== entry.key));
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
});
