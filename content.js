// 全局变量 - 使用window对象存储，避免重复声明
if (typeof window.aiTranslate === 'undefined') {
  window.aiTranslate = {
    isTranslating: false,
    translationAborted: false,
    currentTargetLang: '',
    debugMode: false,
    originalTexts: new Map(), // 存储原始文本，用于恢复
    translatedTexts: new Map(), // 存储翻译后的文本，用于切换
    isTranslated: false, // 标记页面是否已被翻译
    toggleButton: null // 存储切换按钮的引用
  };
}

// 使用简写变量，方便访问
const aiTranslate = window.aiTranslate;

// 初始化标志，确保我们知道content script已加载
console.log('[AI翻译] Content script 已加载');

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AI翻译] 收到消息:', message);
  
  if (message.action === 'ping') {
    // 用于探测content script是否存在，避免消息发送失败
    sendResponse({ status: 'pong' });
    return;
  }
  
  if (message.action === 'translate') {
    // 开始翻译
    aiTranslate.currentTargetLang = message.targetLang;
    console.log('[AI翻译] 开始翻译，目标语言:', aiTranslate.currentTargetLang);
    
    // 立即发送响应，表示已收到请求
    sendResponse({ status: 'started' });
    
    // 异步开始翻译过程
    setTimeout(() => {
      startTranslation(aiTranslate.currentTargetLang).catch(error => {
        console.error('[AI翻译] 翻译过程中出错:', error);
        sendProgressMessage('translationError', null, error.message);
      });
    }, 0);
  } else if (message.action === 'stopTranslation') {
    // 停止翻译
    console.log('[AI翻译] 收到停止翻译请求');
    stopTranslation();
    sendResponse({ status: 'stopped' });
  } else if (message.action === 'toggleLanguage') {
    // 切换语言
    console.log('[AI翻译] 收到切换语言请求');
    toggleLanguage();
    sendResponse({ status: 'toggled', isTranslated: aiTranslate.isTranslated });
  } else if (message.action === 'checkTranslationStatus') {
    // 检查翻译状态
    sendResponse({ 
      isTranslated: aiTranslate.isTranslated,
      currentTargetLang: aiTranslate.currentTargetLang
    });
  } else {
    console.log('[AI翻译] 收到未知消息类型:', message.action);
    sendResponse({ status: 'unknown_action' });
  }
  
  return true; // 保持消息通道开放
});

// 发送测试消息到background，确认通信正常
chrome.runtime.sendMessage({ action: 'contentScriptLoaded' }, response => {
  if (chrome.runtime.lastError) {
    console.error('[AI翻译] 无法连接到background script:', chrome.runtime.lastError);
  } else {
    console.log('[AI翻译] 与background script通信正常:', response);
  }
});

// 获取网页内容
function getPageContent() {
  // 获取页面的可见文本内容
  const bodyText = document.body.innerText;
  
  // 获取页面标题
  const title = document.title;
  
  // 获取页面的meta描述
  let metaDescription = '';
  const metaDescriptionTag = document.querySelector('meta[name="description"]');
  if (metaDescriptionTag) {
    metaDescription = metaDescriptionTag.getAttribute('content') || '';
  }
  
  // 获取页面的h1标题
  let h1Titles = [];
  document.querySelectorAll('h1').forEach(h1 => {
    if (h1.innerText.trim()) {
      h1Titles.push(h1.innerText.trim());
    }
  });
  
  // 组合页面内容
  let pageContent = '';
  
  if (title) {
    pageContent += `标题: ${title}\n\n`;
  }
  
  if (metaDescription) {
    pageContent += `描述: ${metaDescription}\n\n`;
  }
  
  if (h1Titles.length > 0) {
    pageContent += `主标题: ${h1Titles.join(', ')}\n\n`;
  }
  
  // 添加页面正文内容，但限制长度
  const maxBodyLength = 5000; // 限制正文长度，避免API请求过大
  pageContent += `正文内容:\n${bodyText.substring(0, maxBodyLength)}`;
  if (bodyText.length > maxBodyLength) {
    pageContent += '...(内容已截断)';
  }
  
  return pageContent;
}

// 开始翻译
async function startTranslation(targetLang) {
  // 如果已经在翻译中，先停止
  if (aiTranslate.isTranslating) {
    stopTranslation();
    // 等待一小段时间确保之前的翻译已停止
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // 重置状态
  aiTranslate.isTranslating = true;
  aiTranslate.translationAborted = false;
  
  // 获取API配置，检查调试模式
  const config = await getApiConfig();
  aiTranslate.debugMode = config.debugMode;
  aiTranslate.cacheLimitBytes = await getTranslationCacheLimitBytes();
  
  // 记录开始时间（用于调试）
  const startTime = new Date();
  if (aiTranslate.debugMode) {
    console.log(`[AI翻译] 开始翻译，目标语言: ${targetLang}，时间: ${startTime}`);
  }
  
  // 如果页面已经被翻译，先恢复原始文本
  if (aiTranslate.isTranslated) {
    restoreOriginalText();
  }
  
  try {
    // 获取需要翻译的文本节点，并合并相邻短句为“翻译单元”
    const textNodes = getTranslatableTextNodes();
    const units = buildTranslationUnits(textNodes);
    // 记录每个节点对应的原文，供“查看原文/对照下载”使用（按文档顺序登记）
    units.forEach(unit => {
      unit.nodes.forEach(node => {
        if (!aiTranslate.originalTexts.has(node)) {
          aiTranslate.originalTexts.set(node, node.textContent);
        }
      });
    });
    // aiTranslate.units 保留文档顺序，供“下载对照”使用
    aiTranslate.units = units;
    
    // —— 视口优先：把可视区附近的单元排到队首，让首屏先出现译文 ——
    const workUnits = orderUnitsByViewport(units);
    
    // 重置本次会话的文本去重缓存（相同原文只请求一次）
    aiTranslate.dedupeInFlight = new Map();
    
    if (aiTranslate.debugMode) {
      console.log(`[AI翻译] 找到 ${textNodes.length} 个可翻译文本节点，合并为 ${units.length} 个翻译单元`);
    }
    
    // 如果没有可翻译文本节点，提前结束
    if (workUnits.length === 0) {
      sendProgressMessage('translationComplete');
      aiTranslate.isTranslating = false;
      return;
    }
    
    // 页面内容总结改为后台并行：不阻塞翻译，总结就绪后自动用于后续节点的上下文
    let pageSummary = null;
    
    const fetchSummaryInBackground = async () => {
      try {
        sendProgressMessage('summarizingPage');
        const pageContent = getPageContent();
        
        if (aiTranslate.debugMode) {
          console.log(`[AI翻译] 获取到网页内容，长度: ${pageContent.length}`);
        }
        
        const summaryResponse = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'summarizePageContent',
            content: pageContent
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            
            if (response && response.success) {
              resolve(response.summary);
            } else {
              reject(new Error(response?.error || '网页内容总结失败'));
            }
          });
        });
        
        pageSummary = summaryResponse;
        
        if (aiTranslate.debugMode) {
          console.log('[AI翻译] 网页内容总结完成，后续翻译将携带上下文');
        }
      } catch (error) {
        console.error('[AI翻译] 网页内容总结失败（不影响翻译）:', error);
      }
    };
    
    if (config.enablePageSummary) {
      fetchSummaryInBackground();
    }
    
    // —— 并发流水线：信号量限流，单个翻译单元完成后立即写入页面 ——
    const totalUnits = workUnits.length;
    const maxConcurrent = Math.min(6, totalUnits); // 上限 6 路并发
    // 自适应并发：普通错误不降速；触发限流(429/5xx)时自动降并发并冷却，
    // 一段时间无限流后再恢复满并发。
    const RATE_LIMIT_ERROR_RE = /429|rate\s*limit|too\s*many\s*requests|quota|insufficient_quota|502|503|504|overloaded|busy/i;
    let activeLimit = maxConcurrent;
    let inflight = 0;
    let lastRateLimitAt = 0;
    let rateCooldownUntil = 0;
    let rateBackoffMs = 1000;
    let completedCount = 0;
    let failedCount = 0;
    let consecutiveFailures = 0;
    let firstError = null;
    let nextUnitIndex = 0;
    let lastBroadcastPct = -1;

    // 显示页内浮动进度条（关闭弹窗后依然可见，实现"后台翻译"）
    ensureProgressOverlay();
    updateProgressOverlay(`正在翻译 0/${totalUnits} (0%)`);

    const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isRateLimitError = (error) => RATE_LIMIT_ERROR_RE.test((error && error.message) || '');

    // 申请一个并发槽位；并发满或处于限流冷却期时等待
    async function waitForSlot() {
      for (;;) {
        if (aiTranslate.translationAborted) return false;
        // 连续一段时间无限流，则逐步/直接恢复满并发
        if (activeLimit < maxConcurrent && (Date.now() - lastRateLimitAt) > 3000) {
          activeLimit = maxConcurrent;
        }
        if (inflight < activeLimit && Date.now() >= rateCooldownUntil) {
          return true;
        }
        await waitMs(120);
      }
    }

    // 处理单个翻译单元：先查去重缓存，未命中才发起请求，并把请求存入缓存复用
    async function processUnit(unit) {
      const key = unit.original.trim();
      const cache = aiTranslate.dedupeInFlight;

      try {
        let translated;
        if (cache.has(key)) {
          // 相同原文已在途或已完成：复用其结果，避免重复请求
          translated = await cache.get(key);
        } else {
          const pending = requestTranslationForText(unit.original, targetLang, () => pageSummary)
            .catch((error) => {
              cache.delete(key); // 失败则移除缓存，允许后续相同文本重试
              throw error;
            });
          cache.set(key, pending);
          translated = await pending;
        }

        if (aiTranslate.translationAborted) return;
        applyTranslationToUnit(unit, translated, targetLang);
        completedCount++;
        consecutiveFailures = 0;
      } catch (error) {
        failedCount++;
        const errorMsg = (error && error.message) || '';
        if (isRateLimitError(error)) {
          // 限流/服务不可用：降低并发 + 退避冷却，不计入“连续失败中止”逻辑
          activeLimit = Math.max(2, Math.ceil(activeLimit * 0.6));
          lastRateLimitAt = Date.now();
          rateCooldownUntil = Date.now() + rateBackoffMs;
          rateBackoffMs = Math.min(rateBackoffMs * 2, 8000);
          if (aiTranslate.debugMode) {
            console.warn(`[AI翻译] 触发限流，临时降并发至 ${activeLimit}:`, errorMsg);
          }
        } else {
          consecutiveFailures++;
          if (!firstError) firstError = error;
          if (aiTranslate.debugMode) {
            console.warn('[AI翻译] 单个翻译单元失败，已跳过:', errorMsg);
          }
        }
      }

      if (aiTranslate.translationAborted) return;

      // 仅对非限流的连续错误做中止判定
      if (consecutiveFailures >= 5) {
        aiTranslate.translationAborted = true;
        if (!firstError) firstError = new Error('连续多次翻译失败，已中止');
        return;
      }

      const doneCount = completedCount + failedCount;
      const pct = Math.round((doneCount / totalUnits) * 100);
      updateProgressOverlay(`正在翻译 ${doneCount}/${totalUnits} (${pct}%)`);

      // 每完成一个单元都广播进度（按百分比节流），供弹窗/扩展角标实时刷新
      if (pct !== lastBroadcastPct) {
        lastBroadcastPct = pct;
        sendProgressMessage('translationProgress', pct);
      }
    }

    async function worker() {
      for (;;) {
        if (aiTranslate.translationAborted) return;
        if (await waitForSlot() === false) return;
        
        const idx = nextUnitIndex++;
        if (idx >= totalUnits) return;
        
        inflight++;
        try {
          await processUnit(workUnits[idx]);
        } finally {
          inflight--;
        }
      }
    }

    const workers = [];
    for (let i = 0; i < maxConcurrent; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    // —— 收尾：无论完成、中止还是部分失败，尽量保留结果并给出反馈 ——
    const wasUserStopped = aiTranslate.translationAborted && !firstError && consecutiveFailures < 5;

    if (!aiTranslate.translationAborted) {
      // 全部完成
      sendProgressMessage('translationComplete');
      aiTranslate.isTranslated = true;
      createOrShowToggleButton();
      if (aiTranslate.debugMode) {
        const endTime = new Date();
        const duration = (endTime - startTime) / 1000;
        console.log(`[AI翻译] 翻译完成，耗时: ${duration}秒`);
      }
    } else if (completedCount > 0 && !wasUserStopped) {
      // 部分失败，但已翻译的内容保留
      aiTranslate.isTranslated = true;
      createOrShowToggleButton();
      sendProgressMessage('translationError', null, firstError ? firstError.message : '翻译部分失败');
    } else if (firstError) {
      // 完全没有成功翻译任何节点
      aiTranslate.isTranslated = false;
      sendProgressMessage('translationError', null, firstError.message);
    } else {
      // 用户手动停止：保留已完成的翻译
      aiTranslate.isTranslated = completedCount > 0;
      if (completedCount > 0) {
        createOrShowToggleButton();
      }
    }

    hideProgressOverlay();
  } catch (error) {
    console.error('[AI翻译] 翻译过程中出错:', error);
    hideProgressOverlay();
    sendProgressMessage('translationError', null, error.message);
  } finally {
    aiTranslate.isTranslating = false;
  }
}

// 创建页内浮动进度条
function ensureProgressOverlay() {
  // 若已存在则先移除，避免重复
  if (aiTranslate.progressOverlayEl) {
    aiTranslate.progressOverlayEl.remove();
    aiTranslate.progressOverlayEl = null;
  }
  
  const overlay = document.createElement('div');
  overlay.id = 'aiTranslateProgressOverlay';
  overlay.style.cssText = `
    position: fixed;
    bottom: 70px;
    right: 20px;
    background-color: rgba(33, 33, 33, 0.92);
    color: #fff;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-family: Arial, sans-serif;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 320px;
  `;
  
  const label = document.createElement('span');
  label.id = 'aiTranslateProgressLabel';
  label.textContent = '正在翻译...';
  overlay.appendChild(label);
  
  const stopBtn = document.createElement('button');
  stopBtn.textContent = '停止';
  stopBtn.style.cssText = `
    background: none;
    border: 1px solid rgba(255,255,255,0.6);
    color: #fff;
    border-radius: 4px;
    padding: 2px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  `;
  stopBtn.addEventListener('click', () => {
    stopTranslation();
    sendProgressMessage('translationStopped');
    updateProgressOverlay('正在停止...');
    setTimeout(() => {
      if (aiTranslate.translationAborted) {
        hideProgressOverlay();
      }
    }, 800);
  });
  overlay.appendChild(stopBtn);
  
  document.body.appendChild(overlay);
  aiTranslate.progressOverlayEl = overlay;
}

// 更新页内进度条文字
function updateProgressOverlay(text) {
  const overlay = aiTranslate.progressOverlayEl;
  if (!overlay) return;
  const label = overlay.querySelector('#aiTranslateProgressLabel');
  if (label) {
    label.textContent = text;
  }
}

// 移除页内进度条
function hideProgressOverlay() {
  const overlay = aiTranslate.progressOverlayEl;
  if (overlay) {
    overlay.remove();
    aiTranslate.progressOverlayEl = null;
  }
}

// 停止翻译
function stopTranslation() {
  aiTranslate.translationAborted = true;
  aiTranslate.isTranslating = false;
  
  if (aiTranslate.debugMode) {
    console.log('[AI翻译] 手动停止翻译');
  }
}

// 获取可翻译的文本节点
function getTranslatableTextNodes() {
  // 获取所有可见的文本节点
  const textNodes = [];
  const body = document.body;
  
  // 需要排除的元素
  const excludeSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg', 'path', 'meta',
    'link', 'head', 'title', 'input', 'textarea', 'code', 'pre'
  ];
  
  // 递归遍历DOM树
  function traverse(node) {
    // 跳过不可见元素
    if (node.nodeType === Node.ELEMENT_NODE) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return;
      }
      
      // 跳过排除的元素
      if (excludeSelectors.includes(node.tagName.toLowerCase())) {
        return;
      }
    }
    
    // 处理文本节点
    if (node.nodeType === Node.TEXT_NODE) {
      // 使用trim()只是为了检查是否有有意义的文本，但保存原始文本
      const trimmedText = node.textContent.trim();
      // 只处理非空且包含有意义文本的节点
      if (trimmedText && trimmedText.length > 1 && !/^\s*$/.test(trimmedText) && !/^\d+$/.test(trimmedText)) {
        textNodes.push(node);
      }
      return;
    }
    
    // 递归处理子节点
    for (const child of node.childNodes) {
      traverse(child);
    }
  }
  
  traverse(body);
  return textNodes;
}

// 将文本节点列表合并为“翻译单元”：同一父元素下相邻的文本节点（无元素相隔）会
// 合并成一条请求，减少请求数量；合并后仍过长则独立成单元，避免单次请求过大。
function buildTranslationUnits(textNodes, maxChars = 200) {
  const units = [];
  let current = null;
  
  for (const node of textNodes) {
    // 与上一个文本节点是同一父元素下的相邻兄弟时，尝试合并
    if (
      current &&
      node.parentNode === current.parent &&
      node.previousSibling === current.nodes[current.nodes.length - 1] &&
      (current.original.length + node.textContent.length) <= maxChars
    ) {
      current.nodes.push(node);
      current.original += node.textContent;
      continue;
    }
    
    // 不满足合并条件则新开单元
    if (current) {
      units.push(current);
    }
    current = {
      parent: node.parentNode,
      nodes: [node],
      original: node.textContent,
      translated: ''
    };
  }
  
  if (current) {
    units.push(current);
  }
  return units;
}

// 视口优先排序：把可见/紧邻视口的翻译单元排到队首（其余保持原文档顺序），
// 让用户最先在屏幕上看到译文。loadMargin 为视口外预加载余量。
function orderUnitsByViewport(units, loadMargin = 600) {
  const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
  const visible = [];
  const rest = [];
  
  for (const unit of units) {
    const firstNode = unit.nodes[0];
    const anchor = firstNode && (firstNode.parentElement || firstNode.parentNode);
    if (anchor && typeof anchor.getBoundingClientRect === 'function') {
      const rect = anchor.getBoundingClientRect();
      const inView =
        rect.width > 0 && rect.height > 0 &&
        rect.bottom > -loadMargin && rect.top < viewportH + loadMargin &&
        rect.right > -loadMargin && rect.left < viewportW + loadMargin;
      (inView ? visible : rest).push(unit);
    } else {
      // 无法测量（如元素被移除）则排到末尾，避免阻塞
      rest.push(unit);
    }
  }
  
  return visible.concat(rest);
}

// 简单文本哈希（非加密用途，仅用于生成缓存 key）
function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// 跨会话缓存 key：目标语言 + 原文哈希
function translationCacheKey(text, targetLang) {
  return `transCache:${targetLang}:${hashText(text)}`;
}

function storageLocalGet(key) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result || {});
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageLocalSet(obj) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageLocalGetBytesInUse(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.getBytesInUse(keys, (bytes) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(bytes || 0);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageLocalRemove(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.remove(key, () => resolve());
    } catch (error) {
      resolve();
    }
  });
}

function getTranslationCacheLimitBytes() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(['translationCacheLimitMB'], (result) => {
        if (chrome.runtime.lastError) {
          resolve(8 * 1024 * 1024);
          return;
        }
        const configuredMB = Number(result?.translationCacheLimitMB);
        const limitMB = Number.isFinite(configuredMB) && configuredMB >= 1 && configuredMB <= 10
          ? configuredMB
          : 8;
        resolve(limitMB * 1024 * 1024);
      });
    } catch (error) {
      resolve(8 * 1024 * 1024);
    }
  });
}

// 缓存写入后按时间淘汰最旧条目，确保不超过用户设置的容量上限。
async function trimTranslationCache(limitBytes) {
  if (!limitBytes) return;
  try {
    const allData = await storageLocalGet(null);
    const cacheKeys = Object.keys(allData).filter(key => key.startsWith('transCache:'));
    let usage = await storageLocalGetBytesInUse(cacheKeys);
    if (usage <= limitBytes) return;

    const entries = cacheKeys
      .map(key => ({ key, ts: Number(allData[key]?.ts) || 0 }))
      .sort((a, b) => a.ts - b.ts);

    for (const entry of entries) {
      if (usage <= limitBytes) break;
      await storageLocalRemove(entry.key);
      usage = await storageLocalGetBytesInUse(cacheKeys.filter(key => key !== entry.key));
    }
  } catch (error) {
    // 容量整理失败不影响本次翻译结果。
    if (aiTranslate && aiTranslate.debugMode) {
      console.warn('[AI翻译] 整理翻译缓存失败:', error);
    }
  }
}

// 真正向后台发起翻译请求
function sendTranslationRequest(text, targetLang, getSummary) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        action: 'translateText',
        text: text,
        targetLang: targetLang,
        pageSummary: getSummary ? getSummary() : null
      }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = `发送消息错误: ${chrome.runtime.lastError.message}`;
          console.error('[AI翻译]', errorMsg);
          reject(new Error(errorMsg));
          return;
        }
        
        if (response && response.success) {
          resolve(response.translatedText);
        } else {
          const errorMsg = response?.error || '翻译接口返回未知错误';
          console.error('[AI翻译] 翻译失败:', errorMsg, response);
          reject(new Error(errorMsg));
        }
      });
    } catch (error) {
      console.error('[AI翻译] 请求翻译时出错:', error);
      reject(error);
    }
  });
}

// 请求翻译一段文本：优先命中跨会话缓存（chrome.storage.local），未命中才调用 API，
// 成功后写回缓存。pageSummary 通过 getSummary 回调在发请求时读取。
async function requestTranslationForText(text, targetLang, getSummary) {
  const trimmed = String(text || '');
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 缓存有效期 30 天
  const MAX_CACHE_LENGTH = 4000; // 过长的文本不入缓存，避免占用大量配额
  let cacheKey = null;
  
  if (trimmed.length >= 2 && trimmed.length <= MAX_CACHE_LENGTH) {
    cacheKey = translationCacheKey(trimmed, targetLang);
    try {
      const cached = await storageLocalGet(cacheKey);
      const entry = cached && cached[cacheKey];
      if (entry && entry.text === trimmed) {
        if (Date.now() - (entry.ts || 0) < CACHE_TTL_MS) {
          return entry.translation;
        }
        // 过期缓存删除，重新在线翻译
        storageLocalRemove(cacheKey);
      }
    } catch (error) {
      // 缓存读取失败不影响正常请求
      if (aiTranslate && aiTranslate.debugMode) {
        console.warn('[AI翻译] 读取翻译缓存失败，继续在线请求:', error);
      }
    }
  }
  
  const translation = await sendTranslationRequest(text, targetLang, getSummary);
  
  if (cacheKey) {
    try {
      await storageLocalSet({ [cacheKey]: { text: trimmed, translation, ts: Date.now() } });
      await trimTranslationCache(aiTranslate.cacheLimitBytes || 8 * 1024 * 1024);
    } catch (error) {
      // 写缓存失败（如超出配额）可忽略，不影响本次翻译
    }
  }
  
  return translation;
}

// 将一段译文写回翻译单元：整段译文放入单元的第一个文本节点，
// 其余被合并的节点置空（合并的节点在 DOM 中本就无缝相邻，不影响展示）。
function applyTranslationToUnit(unit, translatedText, targetLang) {
  const nodes = unit.nodes;
  unit.translated = translatedText;
  
  // 第一个节点承载整段译文
  aiTranslate.translatedTexts.set(nodes[0], translatedText);
  nodes[0].textContent = translatedText;
  
  // 其余被合并的节点记录空译文（原文仍保留在 originalTexts 用于恢复）
  for (let i = 1; i < nodes.length; i++) {
    aiTranslate.translatedTexts.set(nodes[i], '');
    nodes[i].textContent = '';
  }
  
  // 标记父元素已被翻译
  const parentElement = nodes[0].parentElement;
  if (parentElement) {
    parentElement.dataset.aiTranslated = 'true';
    parentElement.dataset.originalLang = document.documentElement.lang || 'auto';
    parentElement.dataset.targetLang = targetLang;
  }
  
  if (aiTranslate.debugMode) {
    console.log(`[AI翻译] 翻译单元成功: ${unit.original.substring(0, 30)}... => ${translatedText.substring(0, 30)}...`);
  }
  
  return translatedText;
}

// 恢复原始文本
function restoreOriginalText() {
  aiTranslate.originalTexts.forEach((originalText, node) => {
    // 检查节点是否仍然存在于DOM中
    if (node && node.parentElement) {
      // 如果是文本节点
      if (node.nodeType === Node.TEXT_NODE) {
        node.textContent = originalText;
        
        // 移除父元素上的翻译标记
        const parentElement = node.parentElement;
        if (parentElement && parentElement.dataset.aiTranslated === 'true') {
          delete parentElement.dataset.aiTranslated;
          delete parentElement.dataset.originalLang;
          delete parentElement.dataset.targetLang;
        }
      } 
      // 如果是元素节点（兼容旧版本）
      else if (node.nodeType === Node.ELEMENT_NODE && node.dataset.aiTranslated === 'true') {
        node.innerText = originalText;
        delete node.dataset.aiTranslated;
        delete node.dataset.originalLang;
        delete node.dataset.targetLang;
      }
    }
  });
  
  // 标记页面未被翻译
  aiTranslate.isTranslated = false;
  
  // 更新切换按钮状态
  updateToggleButtonState();
  
  if (aiTranslate.debugMode) {
    console.log('[AI翻译] 已恢复原始文本');
  }
}

// 切换语言（在翻译和原始语言之间切换）
function toggleLanguage() {
  if (aiTranslate.isTranslated) {
    // 如果当前是翻译状态，恢复原始文本
    restoreOriginalText();
  } else if (aiTranslate.originalTexts.size > 0) {
    // 如果有保存的翻译，重新应用翻译
    reapplyTranslation();
  } else if (aiTranslate.currentTargetLang) {
    // 如果没有保存的翻译但有目标语言，重新翻译
    startTranslation(aiTranslate.currentTargetLang);
  }
}

// 重新应用之前的翻译（不需要重新调用API）
function reapplyTranslation() {
  // 检查是否有保存的翻译文本
  if (aiTranslate.translatedTexts.size === 0) {
    // 如果没有保存的翻译文本，但有目标语言，重新翻译
    if (aiTranslate.currentTargetLang) {
      startTranslation(aiTranslate.currentTargetLang);
    }
    return;
  }
  
  // 遍历所有保存的翻译文本，恢复翻译后的文本
  aiTranslate.translatedTexts.forEach((translatedText, node) => {
    // 检查节点是否仍然存在于DOM中
    if (node && node.parentElement) {
      // 恢复翻译后的文本
      node.textContent = translatedText;
      
      // 添加已翻译标记到父元素
      const parentElement = node.parentElement;
      if (parentElement) {
        parentElement.dataset.aiTranslated = 'true';
        parentElement.dataset.originalLang = document.documentElement.lang || 'auto';
        parentElement.dataset.targetLang = aiTranslate.currentTargetLang;
      }
    }
  });
  
  // 标记为已翻译状态
  aiTranslate.isTranslated = true;
  
  // 更新切换按钮状态
  updateToggleButtonState();
  
  if (aiTranslate.debugMode) {
    console.log('[AI翻译] 已重新应用翻译');
  }
}

// 创建浮动工具栏（含“查看原文/翻译”切换与“下载对照”两个操作）
function createOrShowToggleButton() {
  // 工具栏不存在则一次性创建
  if (!aiTranslate.toolbar) {
    const toolbar = document.createElement('div');
    toolbar.id = 'aiTranslateToolbar';
    toolbar.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      border-radius: 50px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
      font-size: 14px;
      font-family: Arial, sans-serif;
      z-index: 9999;
      display: flex;
      align-items: center;
      overflow: hidden;
    `;
    
    // —— 切换原文/译文按钮 ——
    const toggleButton = document.createElement('button');
    toggleButton.id = 'aiTranslateToggleButton';
    toggleButton.type = 'button';
    toggleButton.title = '切换原文与译文';
    toggleButton.style.cssText = `
      border: none;
      background-color: #4285f4;
      color: #fff;
      cursor: pointer;
      padding: 9px 16px;
      font-size: 14px;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      transition: all 0.2s ease;
    `;
    toggleButton.addEventListener('mouseenter', () => {
      toggleButton.style.backgroundColor = '#3367d6';
    });
    toggleButton.addEventListener('mouseleave', () => {
      toggleButton.style.backgroundColor = '#4285f4';
    });
    
    const toggleIcon = document.createElement('span');
    toggleIcon.textContent = '🌐';
    const toggleText = document.createElement('span');
    toggleText.id = 'aiTranslateToggleText';
    toggleButton.appendChild(toggleIcon);
    toggleButton.appendChild(toggleText);
    toggleButton.addEventListener('click', () => {
      toggleLanguage();
    });
    
    // —— 下载对照按钮 ——
    const downloadButton = document.createElement('button');
    downloadButton.id = 'aiTranslateDownloadButton';
    downloadButton.type = 'button';
    downloadButton.title = '下载原文与译文对照';
    downloadButton.style.cssText = `
      border: none;
      background-color: #34a853;
      color: #fff;
      cursor: pointer;
      padding: 9px 16px;
      font-size: 14px;
      font-family: inherit;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      transition: all 0.2s ease;
    `;
    downloadButton.addEventListener('mouseenter', () => {
      downloadButton.style.backgroundColor = '#2d9249';
    });
    downloadButton.addEventListener('mouseleave', () => {
      downloadButton.style.backgroundColor = '#34a853';
    });
    
    const downloadIcon = document.createElement('span');
    downloadIcon.textContent = '📥';
    const downloadText = document.createElement('span');
    downloadText.textContent = '下载对照';
    downloadButton.appendChild(downloadIcon);
    downloadButton.appendChild(downloadText);
    downloadButton.addEventListener('click', () => {
      downloadTranslationComparison();
    });
    
    toolbar.appendChild(toggleButton);
    toolbar.appendChild(downloadButton);
    document.body.appendChild(toolbar);
    
    // 保存引用
    aiTranslate.toolbar = toolbar;
    aiTranslate.toggleButton = toggleButton;
    aiTranslate.downloadButton = downloadButton;
  }
  
  aiTranslate.toolbar.style.display = 'flex';
  
  // 更新按钮状态
  updateToggleButtonState();
}

// 一键下载原文与译文对照文件
function downloadTranslationComparison() {
  try {
    // 只导出有成功译文、且原文与译文不同的翻译单元
    const exportUnits = (aiTranslate.units || []).filter((unit) => {
      const src = (unit.original || '').trim();
      const dst = (unit.translated || '').trim();
      return src && dst && src !== dst;
    });
    if (exportUnits.length === 0) {
      showToast('没有可下载的翻译内容，请先翻译页面');
      return;
    }
    
    const parts = [];
    const pageTitle = document.title || '网页翻译对照';
    const targetLangName = aiTranslate.currentTargetLang || '';
    
    parts.push(`# ${pageTitle}`);
    parts.push('');
    parts.push(`> 原文与译文对照（目标语言: ${targetLangName}）`);
    parts.push('');
    parts.push(`> 生成时间: ${new Date().toLocaleString()}`);
    parts.push('');
    
    let index = 0;
    exportUnits.forEach((unit) => {
      const src = (unit.original || '').trim();
      const dst = (unit.translated || '').trim();
      // 跳过空内容、未翻译成功，以及原文等于译文的不可翻译内容（URL/代码等）
      if (!src || !dst || src === dst) return;
      
      index++;
      parts.push(`## 第 ${index} 段`);
      parts.push('');
      parts.push(`### 原文`);
      parts.push('');
      parts.push(src);
      parts.push('');
      parts.push(`**译文**`);
      parts.push('');
      parts.push(dst);
      parts.push('');
      parts.push('---');
      parts.push('');
    });
    
    if (index === 0) {
      showToast('没有可导出的翻译内容');
      return;
    }
    
    const safeTitle = pageTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const filename = `${safeTitle || '网页'}-原文译文对照.md`;
    const content = parts.join('\n');
    
    triggerDownload(content, filename);
    showToast(`已生成对照文件，共 ${index} 段`);
  } catch (error) {
    console.error('[AI翻译] 生成下载文件失败:', error);
    showToast('下载失败: ' + error.message);
  }
}

// 触发浏览器下载
function triggerDownload(content, filename) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 显示短暂提示信息
function showToast(message) {
  const existing = document.getElementById('aiTranslateToast');
  if (existing) {
    existing.remove();
  }
  
  const toast = document.createElement('div');
  toast.id = 'aiTranslateToast';
  toast.style.cssText = `
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(33, 33, 33, 0.92);
    color: #fff;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-family: Arial, sans-serif;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    z-index: 10001;
    pointer-events: none;
    white-space: nowrap;
    max-width: 80vw;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 2500);
}

// 获取翻译文本
function getI18nMessage(key) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({
        action: 'getI18nMessage',
        key: key
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[AI翻译] 获取翻译文本错误:', chrome.runtime.lastError);
          // 如果出错，使用默认文本
          const defaultMessages = {
            'viewOriginal': '查看原文',
            'viewTranslation': '查看翻译'
          };
          resolve(defaultMessages[key] || key);
          return;
        }
        
        if (response && response.success) {
          resolve(response.message);
        } else {
          console.warn('[AI翻译] 获取翻译文本失败:', response);
          // 如果失败，使用默认文本
          const defaultMessages = {
            'viewOriginal': '查看原文',
            'viewTranslation': '查看翻译'
          };
          resolve(defaultMessages[key] || key);
        }
      });
    } catch (error) {
      console.error('[AI翻译] 获取翻译文本异常:', error);
      // 如果异常，使用默认文本
      const defaultMessages = {
        'viewOriginal': '查看原文',
        'viewTranslation': '查看翻译'
      };
      resolve(defaultMessages[key] || key);
    }
  });
}

// 更新切换按钮状态
async function updateToggleButtonState() {
  const toggleButton = aiTranslate.toggleButton;
  if (!toggleButton) return;
  
  const toggleText = document.getElementById('aiTranslateToggleText');
  if (!toggleText) return;
  
  if (aiTranslate.isTranslated) {
    const viewOriginalText = await getI18nMessage('viewOriginal');
    toggleText.textContent = viewOriginalText;
    toggleButton.title = '点击查看原始语言';
  } else {
    const viewTranslationText = await getI18nMessage('viewTranslation');
    toggleText.textContent = viewTranslationText;
    toggleButton.title = '点击查看翻译';
  }
}

// 发送进度消息到popup
function sendProgressMessage(action, progress = null, error = null) {
  const message = { action };
  
  if (progress !== null) {
    message.progress = progress;
  }
  
  if (error !== null) {
    message.error = error;
  }
  
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[AI翻译] 发送进度消息错误:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error('[AI翻译] 发送进度消息异常:', error);
  }
}

// 获取API配置
function getApiConfig() {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ action: 'getApiConfig' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[AI翻译] 获取API配置错误:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        
        if (response && response.success) {
          resolve(response.config);
        } else {
          console.warn('[AI翻译] 获取API配置失败:', response);
          resolve({});
        }
      });
    } catch (error) {
      console.error('[AI翻译] 获取API配置异常:', error);
      reject(error);
    }
  });
}
