// 全局常量：被 service worker、content script、popup、options 共同加载

// chrome.storage.sync 中保存的 API/翻译相关配置项
const API_CONFIG_KEYS = [
  'apiBaseUrl',
  'apiModel',
  'apiKey',
  'temperature',
  'preserveFormatting',
  'enablePageSummary',
  'debugMode',
  'systemPrompt',
  'interfaceLanguage'
];

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_INTERFACE_LANGUAGE = 'zh-CN';

// 翻译缓存（chrome.storage.local）
const TRANSLATION_CACHE_PREFIX = 'transCache:';
const DEFAULT_CACHE_LIMIT_MB = 8;
const MIN_CACHE_LIMIT_MB = 1;
const MAX_CACHE_LIMIT_MB = 10;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 缓存有效期 30 天
const MAX_CACHEABLE_TEXT_LENGTH = 4000; // 过长的文本不入缓存，避免占用大量配额

// 目标语言代码 → 提示词中使用的语言名称
const LANGUAGE_NAMES = {
  'zh-CN': '简体中文',
  'en': '英语',
  'ja': '日语',
  'ko': '韩语',
  'fr': '法语',
  'de': '德语',
  'es': '西班牙语',
  'ru': '俄语'
};

// 扩展注入到页面中的 UI 元素都带有此属性，提取可翻译文本时跳过它们
const UI_MARKER_ATTRIBUTE = 'data-ai-translate-ui';

// 拼接 OpenAI 兼容接口的 chat/completions 地址（容忍 Base URL 末尾的斜杠）
function buildChatCompletionsUrl(apiBaseUrl) {
  return `${String(apiBaseUrl || '').replace(/\/+$/, '')}/chat/completions`;
}

function isApiConfigComplete(config) {
  return Boolean(config && config.apiBaseUrl && config.apiModel && config.apiKey);
}

// 浏览器内部页面无法注入脚本
function isRestrictedUrl(url) {
  const u = String(url || '');
  return u.startsWith('chrome://') ||
    u.startsWith('chrome-extension://') ||
    u.startsWith('https://chrome.google.com/webstore');
}
