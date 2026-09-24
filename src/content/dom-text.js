// 从页面 DOM 中提取可翻译文本，并组织成“翻译单元”

// 不提取文本的元素
const EXCLUDED_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'svg', 'path', 'meta',
  'link', 'head', 'title', 'input', 'textarea', 'code', 'pre'
]);

const MAX_SUMMARY_BODY_LENGTH = 5000; // 限制正文长度，避免总结请求过大

// 获取网页内容（标题、描述、主标题、截断后的正文），用于生成页面总结
function getPageContent() {
  const bodyText = document.body.innerText;
  const title = document.title;
  const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const h1Titles = Array.from(document.querySelectorAll('h1'))
    .map(h1 => h1.innerText.trim())
    .filter(Boolean);

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

  pageContent += `正文内容:\n${bodyText.substring(0, MAX_SUMMARY_BODY_LENGTH)}`;
  if (bodyText.length > MAX_SUMMARY_BODY_LENGTH) {
    pageContent += '...(内容已截断)';
  }

  return pageContent;
}

// 判断文本是否值得翻译：非空、长度大于 1、不是纯数字
function isMeaningfulText(text) {
  const trimmed = text.trim();
  return trimmed.length > 1 && !/^\d+$/.test(trimmed);
}

// 获取可翻译的文本节点（按文档顺序）
function getTranslatableTextNodes(root = document.body) {
  const textNodes = [];

  function traverse(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // 跳过扩展自身注入的 UI、排除的标签与不可见元素
      if (node.hasAttribute(UI_MARKER_ATTRIBUTE) || EXCLUDED_TAGS.has(node.tagName.toLowerCase())) {
        return;
      }
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      if (isMeaningfulText(node.textContent)) {
        textNodes.push(node);
      }
      return;
    }

    for (const child of node.childNodes) {
      traverse(child);
    }
  }

  traverse(root);
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
