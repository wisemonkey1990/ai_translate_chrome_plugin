// 提示词、i18n 与对照导出等纯函数测试
// 运行: node tests/prompts.test.js

const { loadScripts, createChecker } = require('./helpers/load-scripts');

const { check, finish } = createChecker();

const bg = loadScripts([
  'src/shared/constants.js',
  'src/shared/storage.js',
  'src/shared/i18n.js',
  'src/background/prompts.js'
]);

// createTranslationPrompt
{
  const plain = bg.createTranslationPrompt('Hello', 'ja', false, null);
  check('提示词包含目标语言名称', plain.startsWith('请将以下文本翻译成日语:'));
  check('提示词包含原文', plain.includes('\n\nHello\n\n'));
  check('未开启保留格式时不附带格式要求', !plain.includes('请保持原文的格式'));

  const withSummary = bg.createTranslationPrompt('Hello', 'en', true, 'SUMMARY');
  check('带总结时包含总结与待译文本', withSummary.includes('SUMMARY') && withSummary.includes('需要翻译的文本'));
  check('开启保留格式时附带格式要求', withSummary.includes('请保持原文的格式'));
  check('未知语言代码原样使用', bg.getLanguageName('it') === 'it');
}

// buildTranslationMessages：系统提示词回退到界面语言的默认值
{
  const custom = bg.buildTranslationMessages({ systemPrompt: 'CUSTOM' }, 'x', 'en', null);
  check('使用自定义系统提示词', custom[0].role === 'system' && custom[0].content === 'CUSTOM');
  const fallbackEn = bg.buildTranslationMessages({ interfaceLanguage: 'en' }, 'x', 'en', null);
  check('未设置时回退到界面语言默认提示词', fallbackEn[0].content === bg.get('DEFAULT_SYSTEM_PROMPTS').en);
  const fallbackDefault = bg.buildTranslationMessages({}, 'x', 'en', null);
  check('无界面语言时回退中文默认提示词', fallbackDefault[0].content === bg.get('DEFAULT_SYSTEM_PROMPTS')['zh-CN']);
}

// 共享工具
{
  check('Base URL 末尾斜杠被规整', bg.buildChatCompletionsUrl('https://api.x/v1/') === 'https://api.x/v1/chat/completions');
  check('Base URL 无斜杠正常拼接', bg.buildChatCompletionsUrl('https://api.x/v1') === 'https://api.x/v1/chat/completions');
  check('配置完整性检查', bg.isApiConfigComplete({ apiBaseUrl: 'a', apiModel: 'b', apiKey: 'c' }) &&
    !bg.isApiConfigComplete({ apiBaseUrl: 'a', apiModel: 'b' }));
  check('识别受限页面', bg.isRestrictedUrl('chrome://extensions') && !bg.isRestrictedUrl('https://example.com'));
}

// formatI18nMessage
{
  check('按语言取文案', bg.formatI18nMessage('en', 'translatePage') === 'Translate Page');
  check('替换占位符', bg.formatI18nMessage('zh-CN', 'translationProgress', [42]) === '翻译进度: 42%');
  check('未知语言回退中文', bg.formatI18nMessage('xx', 'translatePage') === '翻译页面');
  check('未知 key 返回 key', bg.formatI18nMessage('en', 'noSuchKey') === 'noSuchKey');
  check('识别默认提示词', bg.isDefaultSystemPrompt(bg.get('DEFAULT_SYSTEM_PROMPTS').en) && !bg.isDefaultSystemPrompt('x'));
}

// buildComparisonMarkdown（content/page-ui.js）
{
  const ui = loadScripts(['src/shared/constants.js', 'src/content/page-ui.js']);
  const { content, count } = ui.buildComparisonMarkdown([
    { original: ' Hello ', translated: '你好' },
    { original: 'https://x.com', translated: 'https://x.com' }, // 未翻译内容跳过
    { original: 'Untranslated', translated: '' },
    { original: 'World', translated: '世界' }
  ], { pageTitle: 'Page', targetLang: 'zh-CN', generatedAt: 'NOW' });
  check('只导出有效译文段落', count === 2);
  check('包含标题与目标语言', content.startsWith('# Page\n') && content.includes('目标语言: zh-CN'));
  check('段落编号连续', content.includes('## 第 1 段') && content.includes('## 第 2 段') && !content.includes('## 第 3 段'));
  check('原文已去除首尾空白', content.includes('\nHello\n'));
  check('空列表导出 0 段', ui.buildComparisonMarkdown([], { pageTitle: 'P' }).count === 0);
}

finish();
