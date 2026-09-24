// 提示词构建（纯函数）
// 依赖: constants.js, i18n.js（默认系统提示词）

const SUMMARY_SYSTEM_PROMPT = '你是一个专业的内容分析助手，能够准确地总结网页内容，提取关键信息。请提供简洁明了的总结，不要添加任何不在原文中的信息。';

// 获取语言名称
function getLanguageName(langCode) {
  return LANGUAGE_NAMES[langCode] || langCode;
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

function buildTranslationMessages(config, text, targetLang, pageSummary) {
  return [
    {
      role: 'system',
      content: config.systemPrompt || getDefaultSystemPromptFor(config.interfaceLanguage)
    },
    {
      role: 'user',
      content: createTranslationPrompt(text, targetLang, config.preserveFormatting, pageSummary)
    }
  ];
}

function buildSummaryMessages(content) {
  return [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请简要总结以下网页内容，不超过200字。总结应该包含网页的主题、类型和主要内容，以便于理解网页的整体上下文：\n\n${content}`
    }
  ];
}
