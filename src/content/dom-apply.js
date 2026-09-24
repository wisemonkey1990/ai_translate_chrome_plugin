// 把译文写入页面，以及在原文/译文之间切换

function markTranslated(element, targetLang) {
  element.dataset.aiTranslated = 'true';
  element.dataset.originalLang = document.documentElement.lang || 'auto';
  element.dataset.targetLang = targetLang;
}

function unmarkTranslated(element) {
  delete element.dataset.aiTranslated;
  delete element.dataset.originalLang;
  delete element.dataset.targetLang;
}

// 登记每个节点的原文，供“查看原文/对照下载”使用
function rememberOriginalTexts(units) {
  units.forEach(unit => {
    unit.nodes.forEach(node => {
      if (!aiTranslate.originalTexts.has(node)) {
        aiTranslate.originalTexts.set(node, node.textContent);
      }
    });
  });
}

// 将一段译文写回翻译单元：整段译文放入单元的第一个文本节点，
// 其余被合并的节点置空（合并的节点在 DOM 中本就无缝相邻，不影响展示）。
function applyTranslationToUnit(unit, translatedText, targetLang) {
  const nodes = unit.nodes;
  unit.translated = translatedText;

  aiTranslate.translatedTexts.set(nodes[0], translatedText);
  nodes[0].textContent = translatedText;

  // 其余被合并的节点记录空译文（原文仍保留在 originalTexts 用于恢复）
  for (let i = 1; i < nodes.length; i++) {
    aiTranslate.translatedTexts.set(nodes[i], '');
    nodes[i].textContent = '';
  }

  if (nodes[0].parentElement) {
    markTranslated(nodes[0].parentElement, targetLang);
  }

  debugLog(`翻译单元成功: ${unit.original.substring(0, 30)}... => ${translatedText.substring(0, 30)}...`);
}

// 恢复原始文本
function restoreOriginalText() {
  aiTranslate.originalTexts.forEach((originalText, node) => {
    // 节点已被页面移除则跳过
    if (!node || !node.parentElement) return;
    node.textContent = originalText;
    if (node.parentElement.dataset.aiTranslated === 'true') {
      unmarkTranslated(node.parentElement);
    }
  });

  aiTranslate.isTranslated = false;
  updateToggleButtonState();
  debugLog('已恢复原始文本');
}

// 重新应用之前的翻译（不需要重新调用API）
function reapplyTranslation() {
  aiTranslate.translatedTexts.forEach((translatedText, node) => {
    if (!node || !node.parentElement) return;
    node.textContent = translatedText;
    markTranslated(node.parentElement, aiTranslate.currentTargetLang);
  });

  aiTranslate.isTranslated = true;
  updateToggleButtonState();
  debugLog('已重新应用翻译');
}
