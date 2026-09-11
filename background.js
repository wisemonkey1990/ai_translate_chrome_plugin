// 调试开关：仅在用户开启“调试模式”时输出详细日志，避免生产环境刷屏。
let DEBUG = false;
chrome.storage.sync.get(['debugMode'], (result) => {
  if (!chrome.runtime.lastError) DEBUG = !!result.debugMode;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.debugMode) {
    DEBUG = !!changes.debugMode.newValue;
  }
});
function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debugLog('收到消息:', request, '来自:', sender);

  if (request.action === 'contentScriptLoaded') {
    // 响应content script的测试消息
    debugLog('Content script 已加载，通信正常');
    sendResponse({ status: 'background_received' });
    return true;
  }
  
  if (request.action === 'summarizePageContent') {
    debugLog('收到网页内容总结请求，内容长度:', request.content && request.content.length);
    
    // 验证请求参数
    if (!request.content) {
      console.error('网页内容总结请求参数不完整');
      sendResponse({ 
        success: false, 
        error: '网页内容总结请求参数不完整' 
      });
      return true;
    }
    
    // 使用Promise.race添加超时处理
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('网页内容总结请求超时')), 60000); // 60秒超时
    });
    
    Promise.race([
      summarizePageContent(request.content),
      timeoutPromise
    ])
      .then(summary => {
        debugLog('网页内容总结成功，返回结果:', summary);
        sendResponse({ success: true, summary });
      })
      .catch(error => {
        console.error('网页内容总结错误:', error);
        sendResponse({ 
          success: false, 
          error: error.message || '网页内容总结过程中发生未知错误' 
        });
      });
    
    return true; // 保持消息通道开放，以便异步响应
  }
  
  if (request.action === 'translateText') {
    debugLog('收到翻译请求:', (request.text || '').substring(0, 30) + '...', '目标语言:', request.targetLang);
    
    // 验证请求参数
    if (!request.text || !request.targetLang) {
      console.error('翻译请求参数不完整');
      sendResponse({ 
        success: false, 
        error: '翻译请求参数不完整' 
      });
      return true;
    }
    
    // 使用Promise.race添加超时处理
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('翻译请求超时')), 30000); // 30秒超时
    });
    
    Promise.race([
      translateText(request.text, request.targetLang, request.pageSummary),
      timeoutPromise
    ])
      .then(translatedText => {
        debugLog('翻译成功，返回结果: ' + translatedText);
        sendResponse({ success: true, translatedText });
      })
      .catch(error => {
        console.error('翻译错误:', error);
        sendResponse({ 
          success: false, 
          error: error.message || '翻译过程中发生未知错误' 
        });
      });
    
    return true; // 保持消息通道开放，以便异步响应
  }
  
  if (request.action === 'getApiConfig') {
    debugLog('收到获取API配置请求');

    try {
      // 安全：content script 只需要以下开关，绝不下发 apiKey/apiBaseUrl 等敏感配置。
      // 真正的 API 请求全部在 background 内完成，密钥不离开 service worker。
      chrome.storage.sync.get(['enablePageSummary', 'debugMode'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('获取API配置错误:', chrome.runtime.lastError);
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
          return;
        }

        sendResponse({
          success: true,
          config: {
            enablePageSummary: !!result.enablePageSummary,
            debugMode: !!result.debugMode
          }
        });
      });
    } catch (error) {
      console.error('获取API配置异常:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }

    return true; // 保持消息通道开放，以便异步响应
  }
  
  // 后台翻译进度 → 更新扩展图标角标（弹窗关闭后也能看到进度）
  if (request.action === 'translationProgress' ||
      request.action === 'translationComplete' ||
      request.action === 'translationError' ||
      request.action === 'translationStopped' ||
      request.action === 'summarizingPage') {
    updateTranslationBadge(request);
    sendResponse({ received: true });
    return true;
  }
  
  // 处理未知消息类型
  debugLog('收到未知消息类型:', request.action);
  sendResponse({ success: false, error: '未知消息类型' });
  return true;
});

// 根据翻译状态更新扩展图标角标
function updateTranslationBadge(request) {
  try {
    if (request.action === 'summarizingPage') {
      chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
      chrome.action.setBadgeText({ text: '…' });
    } else if (request.action === 'translationProgress') {
      chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
      const pct = Math.min(100, Math.max(0, Math.round(request.progress || 0)));
      chrome.action.setBadgeText({ text: pct + '%' });
    } else if (request.action === 'translationComplete') {
      chrome.action.setBadgeBackgroundColor({ color: '#34a853' });
      chrome.action.setBadgeText({ text: '✓' });
      // 4 秒后自动清除角标
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, 4000);
    } else if (request.action === 'translationError' || request.action === 'translationStopped') {
      chrome.action.setBadgeBackgroundColor({ color: '#ea4335' });
      chrome.action.setBadgeText({ text: '!' });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, 4000);
    }
  } catch (error) {
    console.error('更新角标失败:', error);
  }
}

// 使用LLM API总结网页内容
async function summarizePageContent(content) {
  // 获取API配置
  const config = await getApiConfig();
  
  // 验证配置
  if (!config.apiBaseUrl || !config.apiModel || !config.apiKey) {
    throw new Error('API配置不完整，请在选项页面中设置API信息');
  }
  
  // 构建API请求URL
  const apiUrl = `${config.apiBaseUrl}/chat/completions`;
  
  // 构建提示词
  const prompt = `请简要总结以下网页内容，不超过200字。总结应该包含网页的主题、类型和主要内容，以便于理解网页的整体上下文：\n\n${content}`;
  
  // 构建请求参数
  const requestBody = {
    model: config.apiModel,
    messages: [
      {
        role: "system",
        content: "你是一个专业的内容分析助手，能够准确地总结网页内容，提取关键信息。请提供简洁明了的总结，不要添加任何不在原文中的信息。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.3,
  };
  
  // 调试模式下记录请求
  if (config.debugMode) {
    console.log('Summary request:', {
      url: apiUrl,
      body: {
        ...requestBody,
        messages: [
          requestBody.messages[0],
          {
            role: "user",
            content: prompt.substring(0, 100) + "..." // 只记录提示词的前100个字符
          }
        ]
      }
    });
  }
  
  try {
    // 发送API请求（429/5xx/网络错误自动指数退避重试）
    const response = await fetchWithRetry(apiUrl, requestBody, config);
    
    // 解析响应
    const data = await response.json();
    
    // 调试模式下记录响应
    if (config.debugMode) {
      console.log('Summary response:', data);
    }
    
    // 提取总结结果
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      return cleanModelOutput(data.choices[0].message.content);
    } else {
      throw new Error('API响应格式不正确');
    }
  } catch (error) {
    console.error('Summary API error:', error);
    throw error;
  }
}

// 使用LLM API翻译文本
async function translateText(text, targetLang, pageSummary) {
  // 获取API配置
  const config = await getApiConfig();
  
  // 验证配置
  if (!config.apiBaseUrl || !config.apiModel || !config.apiKey) {
    throw new Error('API配置不完整，请在选项页面中设置API信息');
  }
  
  // 构建API请求URL
  const apiUrl = `${config.apiBaseUrl}/chat/completions`;
  
  // 构建提示词
  const prompt = createTranslationPrompt(text, targetLang, config.preserveFormatting, pageSummary);
  
  // 构建请求参数
  const requestBody = {
    model: config.apiModel,
    messages: [
      {
        role: "system",
        content: config.systemPrompt || "你是一个专业的翻译助手，能够准确地将文本翻译成目标语言，同时保持原文的格式和风格。如果原文不是可被翻译的类型（比如URL、无意义的字母和数字的组合、代码片段、emoji等），那么请直接返回原文。请只返回最终的翻译结果，不要包含任何解释、原文或网页内容总结。HTML标签名称应根据其功能翻译，例如'strong'应翻译为'加粗'，'em'应翻译为'强调'或'斜体'等。"
      },
      {
        role: "user",
        content: prompt
      }
    ],
    // 注意用 ?? 而非 ||：用户显式设置 temperature 为 0（最确定输出）时不应被替换成 0.3
    temperature: config.temperature ?? 0.3,
  };

  // 调试模式下记录请求
  if (config.debugMode) {
    console.log('Translation request:', {
      url: apiUrl,
      body: requestBody
    });
  }
  
  try {
    // 发送API请求（429/5xx/网络错误自动指数退避重试）
    const response = await fetchWithRetry(apiUrl, requestBody, config);
    
    // 解析响应
    const data = await response.json();
    
    // 调试模式下记录响应
    if (config.debugMode) {
      console.log('Translation response:', data);
    }
    
    // 提取翻译结果
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      return cleanModelOutput(data.choices[0].message.content);
    } else {
      throw new Error('API响应格式不正确');
    }
  } catch (error) {
    console.error('Translation API error:', error);
    throw error;
  }
}

// 创建翻译提示词
function createTranslationPrompt(text, targetLang, preserveFormatting, pageSummary) {
  let prompt = `请将以下文本翻译成${getLanguageName(targetLang)}:`;
  
  // 如果有网页内容总结，添加到提示词中
  if (pageSummary) {
    prompt += `\n\n以下是网页内容的总结，仅供参考以便更好地理解上下文，请不要在翻译结果中包含这段总结内容：\n${pageSummary}\n\n需要翻译的文本（请只返回这部分内容的翻译结果）：\n${text}\n\n`;
  } else {
    prompt += `\n\n${text}\n\n`;
  }
  
  if (preserveFormatting) {
    prompt += '请保持原文的格式，包括段落、换行、标点符号等。只翻译文本内容，不要添加或删除任何格式元素。';
  }
  
  prompt += '\n\n重要提示：请只返回翻译后的文本，不要包含任何解释、原文或网页内容总结，并且不要返回这句prompt。';
  
  return prompt;
}

// 获取语言名称
function getLanguageName(langCode) {
  const languages = {
    'zh-CN': '简体中文',
    'en': '英语',
    'ja': '日语',
    'ko': '韩语',
    'fr': '法语',
    'de': '德语',
    'es': '西班牙语',
    'ru': '俄语'
  };
  
  return languages[langCode] || langCode;
}

// 获取API配置
function getApiConfig() {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.sync.get([
        'apiBaseUrl',
        'apiModel',
        'apiKey',
        'temperature',
        'preserveFormatting',
        'enablePageSummary',
        'debugMode',
        'systemPrompt'
      ], (result) => {
        if (chrome.runtime.lastError) {
          console.error('获取API配置错误:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result);
      });
    } catch (error) {
      console.error('获取API配置异常:', error);
      reject(error);
    }
  });
}

// 清洗模型输出中夹带的思维链/推理标签（如 <think>...</think>、<reasoning> 等）
function cleanModelOutput(text) {
  if (!text) return text;
  
  let cleaned = String(text);
  
  // 1. 移除成对的思维链块（含换行内容）
  cleaned = cleaned.replace(/<\s*(think|thinking|reasoning|analysis|thought)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  
  // 2. 移除成对的 [thinking]/[reasoning] 块（部分服务使用方括号形式）
  cleaned = cleaned.replace(/\[\s*(thinking|reasoning|analysis|thought)\s*\][\s\S]*?\[\s*\/\s*\1\s*\]/gi, '');
  
  // 3. 移除残留的单个开/闭标签（可能被截断导致的孤立 </think>）
  cleaned = cleaned.replace(/<\s*\/?\s*(think|thinking|reasoning|analysis|thought)\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/\[\s*\/?\s*(thinking|reasoning|analysis|thought)\s*\]/gi, '');
  
  cleaned = cleaned.trim();
  
  // 若全部被清空，退回原始文本，避免返回空内容
  return cleaned || String(text).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 发送 API 请求并对可重试错误做指数退避重试：
// - 429 与 5xx：最多重试 2 次，退避时间随次数翻倍（429 用更长间隔）
// - 网络异常：同样退避重试
// 返回已成功的 response；重试耗尽后抛出带状态码的错误（content 侧据此限流回退）
async function fetchWithRetry(apiUrl, requestBody, config, maxAttempts = 3) {
  let lastError = null;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
    } catch (netError) {
      lastError = netError;
      if (attempt < maxAttempts - 1) {
        await sleep(1500 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
    
    if (response.ok) {
      return response;
    }
    
    const errorData = await response.json().catch(() => ({}));
    const message = `API错误 (${response.status}): ${errorData.error?.message || response.statusText}`;
    const retriable = response.status === 429 || response.status >= 500;
    
    if (retriable && attempt < maxAttempts - 1) {
      const baseDelay = response.status === 429 ? 1500 : 800;
      await sleep(baseDelay * Math.pow(2, attempt));
      continue;
    }
    
    // 重试耗尽：抛出携带状态码的错误，content 侧可据此做并发回退
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  
  throw new Error(lastError ? `网络请求失败: ${lastError.message}` : 'API请求失败');
}
