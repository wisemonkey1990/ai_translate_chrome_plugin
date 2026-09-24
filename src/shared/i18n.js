// 界面多语言文案与默认系统提示词
// 依赖: constants.js, storage.js
const I18N_MESSAGES = {
  // 中文
  'zh-CN': {
    // 通用
    'appName': 'AI 网页翻译',
    'settings': '设置',
    
    // popup.html
    'targetLanguage': '目标语言',
    'translatePage': '翻译页面',
    'viewOriginal': '查看原文',
    'viewTranslation': '查看翻译',
    'stopTranslation': '停止翻译',
    'translating': '正在翻译...',
    'analyzingPage': '正在分析网页内容...',
    'translationProgress': '翻译进度: {0}%',
    'translationComplete': '翻译完成',
    'translationStopped': '翻译已停止',
    'switchedToTranslation': '已切换到翻译版本',
    'switchedToOriginal': '已切换到原始版本',
    'apiConfigured': 'API已配置',
    'apiNotConfigured': 'API未配置',
    'configureApiFirst': '请先在设置中配置API',
    'error': '错误: {0}',
    'cannotGetTab': '错误: 无法获取当前标签页',
    'cannotRunOnPage': '错误: 无法在此页面上运行翻译功能',
    
    // options.html
    'appSettings': 'AI 网页翻译设置',
    'interfaceLanguage': '界面语言',
    'apiBaseUrlLabel': 'API Base URL:',
    'apiBaseUrlPlaceholder': '例如: https://api.openai.com/v1',
    'apiBaseUrlHelp': 'OpenAI API或兼容API的基础URL',
    'modelNameLabel': '模型名称:',
    'modelNamePlaceholder': '例如: gpt-3.5-turbo',
    'modelNameHelp': '要使用的LLM模型名称',
    'apiKeyLabel': 'API Key:',
    'apiKeyPlaceholder': '输入您的API密钥',
    'apiKeyHelp': '您的API密钥，将安全地存储在浏览器中',

    'temperatureLabel': 'Temperature (可选):',
    'temperaturePlaceholder': '0.0 - 1.0',
    'temperatureHelp': '控制输出的随机性，0为最确定，1为最随机',
    'preserveFormattingLabel': '尽量保留原始格式',
    'preserveFormattingHelp': '尝试在翻译时保留原始文本的格式和布局',
    'enablePageSummaryLabel': '启用网页内容总结',
    'enablePageSummaryHelp': '在翻译前先总结网页内容，提供上下文以提高翻译质量（可能增加API使用量）',
    'debugModeLabel': '调试模式',
    'debugModeHelp': '启用控制台日志记录以进行故障排除',
    'systemPromptLabel': '系统提示词:',
    'systemPromptPlaceholder': '输入自定义系统提示词',
    'systemPromptHelp': '自定义翻译系统提示词，用于指导AI如何翻译内容',
    'resetPrompt': '恢复默认提示词',
    'saveSettings': '保存设置',
    'testConnection': '测试连接',
    'resetSettings': '重置设置',
    'settingsSaved': '设置已保存',
    'defaultPromptRestored': '已恢复默认系统提示词',
    'fillRequiredFields': '请填写所有必填字段',
    'enterValidUrl': '请输入有效的API Base URL',
    'fillApiConfig': '请先填写API配置',
    'testingConnection': '正在测试API连接...',
    'connectionSuccess': 'API连接成功！',
    'invalidResponse': 'API响应格式不正确',
    'connectionFailed': '连接失败: {0}',
    'confirmReset': '确定要重置所有设置吗？这将删除所有已保存的API配置。',
    'settingsReset': '所有设置已重置'
  },
  
  // 英文
  'en': {
    // Common
    'appName': 'AI Web Translator',
    'settings': 'Settings',
    
    // popup.html
    'targetLanguage': 'Target Language',
    'translatePage': 'Translate Page',
    'viewOriginal': 'View Original',
    'viewTranslation': 'View Translation',
    'stopTranslation': 'Stop Translation',
    'translating': 'Translating...',
    'analyzingPage': 'Analyzing page content...',
    'translationProgress': 'Translation progress: {0}%',
    'translationComplete': 'Translation complete',
    'translationStopped': 'Translation stopped',
    'switchedToTranslation': 'Switched to translated version',
    'switchedToOriginal': 'Switched to original version',
    'apiConfigured': 'API Configured',
    'apiNotConfigured': 'API Not Configured',
    'configureApiFirst': 'Please configure API in settings first',
    'error': 'Error: {0}',
    'cannotGetTab': 'Error: Cannot get current tab',
    'cannotRunOnPage': 'Error: Cannot run translation on this page',
    
    // options.html
    'appSettings': 'AI Web Translator Settings',
    'interfaceLanguage': 'Interface Language',
    'apiBaseUrlLabel': 'API Base URL:',
    'apiBaseUrlPlaceholder': 'e.g., https://api.openai.com/v1',
    'apiBaseUrlHelp': 'Base URL for OpenAI API or compatible API',
    'modelNameLabel': 'Model Name:',
    'modelNamePlaceholder': 'e.g., gpt-3.5-turbo',
    'modelNameHelp': 'Name of the LLM model to use',
    'apiKeyLabel': 'API Key:',
    'apiKeyPlaceholder': 'Enter your API key',
    'apiKeyHelp': 'Your API key, will be stored securely in your browser',

    'temperatureLabel': 'Temperature (Optional):',
    'temperaturePlaceholder': '0.0 - 1.0',
    'temperatureHelp': 'Controls randomness of output, 0 for deterministic, 1 for random',
    'preserveFormattingLabel': 'Preserve Original Formatting',
    'preserveFormattingHelp': 'Try to preserve the format and layout of the original text when translating',
    'enablePageSummaryLabel': 'Enable Page Content Summary',
    'enablePageSummaryHelp': 'Summarize page content before translation to provide context for better quality (may increase API usage)',
    'debugModeLabel': 'Debug Mode',
    'debugModeHelp': 'Enable console logging for troubleshooting',
    'systemPromptLabel': 'System Prompt:',
    'systemPromptPlaceholder': 'Enter custom system prompt',
    'systemPromptHelp': 'Custom system prompt for translation to guide how AI translates content',
    'resetPrompt': 'Reset to Default',
    'saveSettings': 'Save Settings',
    'testConnection': 'Test Connection',
    'resetSettings': 'Reset Settings',
    'settingsSaved': 'Settings saved',
    'defaultPromptRestored': 'Default system prompt restored',
    'fillRequiredFields': 'Please fill in all required fields',
    'enterValidUrl': 'Please enter a valid API Base URL',
    'fillApiConfig': 'Please fill in API configuration first',
    'testingConnection': 'Testing API connection...',
    'connectionSuccess': 'API connection successful!',
    'invalidResponse': 'Invalid API response format',
    'connectionFailed': 'Connection failed: {0}',
    'confirmReset': 'Are you sure you want to reset all settings? This will delete all saved API configurations.',
    'settingsReset': 'All settings have been reset'
  }
};

// 纯函数：按语言取文案并替换 {0}、{1}… 占位符，缺失时回退中文或 key 本身
function formatI18nMessage(lang, key, args = []) {
  const table = I18N_MESSAGES[lang] || I18N_MESSAGES[DEFAULT_INTERFACE_LANGUAGE];
  let message = table[key] || I18N_MESSAGES[DEFAULT_INTERFACE_LANGUAGE][key] || key;
  args.forEach((arg, index) => {
    message = message.replace(`{${index}}`, arg);
  });
  return message;
}

// 获取当前界面语言
async function getCurrentLanguage() {
  try {
    const result = await syncGet(['interfaceLanguage']);
    return result.interfaceLanguage || DEFAULT_INTERFACE_LANGUAGE;
  } catch (error) {
    return DEFAULT_INTERFACE_LANGUAGE;
  }
}

// 获取翻译文本
async function getI18nMessage(key, ...args) {
  return formatI18nMessage(await getCurrentLanguage(), key, args);
}

// 翻译页面中所有带 data-i18n 属性的元素
async function translatePage() {
  const lang = await getCurrentLanguage();
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const message = formatI18nMessage(lang, element.getAttribute('data-i18n'));
    if ((element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') && element.hasAttribute('placeholder')) {
      element.placeholder = message;
    } else {
      element.textContent = message;
    }
  });
}

// 默认系统提示词
const DEFAULT_SYSTEM_PROMPTS = {
  'zh-CN': `你是一个专业的翻译助手，能够准确地将文本翻译成目标语言，同时保持原文的格式和风格。请注意以下特殊情况：

1. HTML标签名称应根据其功能翻译，例如'strong'应翻译为'加粗'，'em'应翻译为'强调'或'斜体'等。

2. 如果原文不是可被翻译的类型（比如URL、无意义的字母和数字的组合、代码片段、emoji等），那么请直接返回原文。

请只返回最终的结果，不必附带额外的解释信息。`,

  'en': `You are a professional translation assistant who can accurately translate text into the target language while maintaining the format and style of the original text. Please note the following special cases:

1. HTML tag names should be translated according to their functions, for example, 'strong' should be translated as 'bold', 'em' should be translated as 'emphasis' or 'italic', etc.

2. If the original text is not a translatable type (such as URLs, meaningless combinations of letters and numbers, code snippets, emojis, etc.), please return the original text directly.

Please only return the final result without additional explanatory information.`
};

function getDefaultSystemPromptFor(lang) {
  return DEFAULT_SYSTEM_PROMPTS[lang] || DEFAULT_SYSTEM_PROMPTS[DEFAULT_INTERFACE_LANGUAGE];
}

// 获取当前界面语言的默认系统提示词
async function getDefaultSystemPrompt() {
  return getDefaultSystemPromptFor(await getCurrentLanguage());
}

function isDefaultSystemPrompt(prompt) {
  return Object.values(DEFAULT_SYSTEM_PROMPTS).includes(prompt);
}
