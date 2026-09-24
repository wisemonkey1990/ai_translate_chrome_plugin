// 页面级翻译状态 - 挂在 window 上，脚本被重复注入时复用同一份状态
if (typeof window.aiTranslate === 'undefined') {
  window.aiTranslate = {
    isTranslating: false,
    translationAborted: false,
    currentTargetLang: '',
    debugMode: false,
    cacheLimitBytes: DEFAULT_CACHE_LIMIT_MB * 1024 * 1024,
    originalTexts: new Map(), // 文本节点 → 原文，用于恢复
    translatedTexts: new Map(), // 文本节点 → 译文，用于切换
    units: [], // 按文档顺序的翻译单元，供“下载对照”使用
    isTranslated: false, // 页面当前是否显示译文
    toolbar: null,
    toggleButton: null,
    progressOverlayEl: null
  };
}

// 使用简写变量，方便访问
var aiTranslate = window.aiTranslate;

function debugLog(...args) {
  if (aiTranslate.debugMode) {
    console.log('[AI翻译]', ...args);
  }
}
