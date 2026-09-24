// 注入页面的界面：浮动进度条、原文/译文切换工具栏、下载对照、Toast 提示。
// 所有根元素都带 UI_MARKER_ATTRIBUTE，避免被当作页面内容翻译。

function createUiElement(tag, id, cssText) {
  const el = document.createElement(tag);
  el.id = id;
  el.setAttribute(UI_MARKER_ATTRIBUTE, '');
  el.style.cssText = cssText;
  return el;
}

// ---------- 页内浮动进度条（关闭弹窗后依然可见，实现"后台翻译"） ----------

function ensureProgressOverlay() {
  hideProgressOverlay();

  const overlay = createUiElement('div', 'aiTranslateProgressOverlay', `
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
  `);

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

function updateProgressOverlay(text) {
  const label = aiTranslate.progressOverlayEl?.querySelector('#aiTranslateProgressLabel');
  if (label) {
    label.textContent = text;
  }
}

function hideProgressOverlay() {
  if (aiTranslate.progressOverlayEl) {
    aiTranslate.progressOverlayEl.remove();
    aiTranslate.progressOverlayEl = null;
  }
}

// ---------- 浮动工具栏（“查看原文/翻译”切换 + “下载对照”） ----------

function createToolbarButton({ id, title, icon, text, color, hoverColor, onClick }) {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.title = title;
  button.style.cssText = `
    border: none;
    background-color: ${color};
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
  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = hoverColor;
  });
  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = color;
  });
  button.addEventListener('click', onClick);

  const iconEl = document.createElement('span');
  iconEl.textContent = icon;
  const textEl = document.createElement('span');
  textEl.textContent = text;
  button.appendChild(iconEl);
  button.appendChild(textEl);
  return { button, textEl };
}

function createOrShowToggleButton() {
  if (!aiTranslate.toolbar) {
    const toolbar = createUiElement('div', 'aiTranslateToolbar', `
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
    `);

    const toggle = createToolbarButton({
      id: 'aiTranslateToggleButton',
      title: '切换原文与译文',
      icon: '🌐',
      text: '',
      color: '#4285f4',
      hoverColor: '#3367d6',
      onClick: () => toggleLanguage()
    });
    toggle.textEl.id = 'aiTranslateToggleText';

    const download = createToolbarButton({
      id: 'aiTranslateDownloadButton',
      title: '下载原文与译文对照',
      icon: '📥',
      text: '下载对照',
      color: '#34a853',
      hoverColor: '#2d9249',
      onClick: () => downloadTranslationComparison()
    });

    toolbar.appendChild(toggle.button);
    toolbar.appendChild(download.button);
    document.body.appendChild(toolbar);

    aiTranslate.toolbar = toolbar;
    aiTranslate.toggleButton = toggle.button;
  }

  aiTranslate.toolbar.style.display = 'flex';
  updateToggleButtonState();
}

// 根据当前显示状态更新切换按钮的文字
async function updateToggleButtonState() {
  const toggleButton = aiTranslate.toggleButton;
  const toggleText = toggleButton?.querySelector('#aiTranslateToggleText');
  if (!toggleText) return;

  if (aiTranslate.isTranslated) {
    toggleText.textContent = await getI18nMessage('viewOriginal');
    toggleButton.title = '点击查看原始语言';
  } else {
    toggleText.textContent = await getI18nMessage('viewTranslation');
    toggleButton.title = '点击查看翻译';
  }
}

// ---------- 下载原文与译文对照 ----------

// 生成 Markdown 对照文本；只导出有译文、且译文与原文不同的单元（跳过 URL/代码等未翻译内容）
function buildComparisonMarkdown(units, { pageTitle, targetLang, generatedAt }) {
  const pairs = (units || [])
    .map(unit => ({ src: (unit.original || '').trim(), dst: (unit.translated || '').trim() }))
    .filter(({ src, dst }) => src && dst && src !== dst);

  const parts = [
    `# ${pageTitle}`,
    '',
    `> 原文与译文对照（目标语言: ${targetLang || ''}）`,
    '',
    `> 生成时间: ${generatedAt}`,
    ''
  ];
  pairs.forEach(({ src, dst }, i) => {
    parts.push(`## 第 ${i + 1} 段`, '', '### 原文', '', src, '', '**译文**', '', dst, '', '---', '');
  });

  return { content: parts.join('\n'), count: pairs.length };
}

function downloadTranslationComparison() {
  try {
    const pageTitle = document.title || '网页翻译对照';
    const { content, count } = buildComparisonMarkdown(aiTranslate.units, {
      pageTitle,
      targetLang: aiTranslate.currentTargetLang,
      generatedAt: new Date().toLocaleString()
    });
    if (count === 0) {
      showToast('没有可下载的翻译内容，请先翻译页面');
      return;
    }

    const safeTitle = pageTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    triggerDownload(content, `${safeTitle || '网页'}-原文译文对照.md`);
    showToast(`已生成对照文件，共 ${count} 段`);
  } catch (error) {
    console.error('[AI翻译] 生成下载文件失败:', error);
    showToast('下载失败: ' + error.message);
  }
}

function triggerDownload(content, filename) {
  const blob = new Blob(['﻿' + content], { type: 'text/markdown;charset=utf-8' });
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

// ---------- Toast ----------

function showToast(message) {
  document.getElementById('aiTranslateToast')?.remove();

  const toast = createUiElement('div', 'aiTranslateToast', `
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
  `);
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2500);
}
