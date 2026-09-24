// cleanModelOutput 单元测试
// 加载 src/background/llm-client.js 中的真实实现执行。
// 运行: node tests/cleanModelOutput.test.js

const { loadScripts } = require('./helpers/load-scripts');

const ctx = loadScripts(['src/shared/constants.js', 'src/background/llm-client.js']);
const cleanModelOutput = ctx.cleanModelOutput;

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`   期望: ${JSON.stringify(expected)}`);
    console.error(`   实际: ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(actual, expected, name) {
  if (typeof actual === 'string' && actual.includes(expected)) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`   期望包含: ${JSON.stringify(expected)}`);
    console.error(`   实际: ${JSON.stringify(actual)}`);
  }
}

// ---------- 完整成对的 <think> 标签 ----------
assertEqual(
  cleanModelOutput('<think>用户想翻译这句话</think>你好，世界。'),
  '你好，世界。',
  '成对 <think> 在开头：只保留正文'
);
assertEqual(
  cleanModelOutput('你好，世界。<think>这是思考</think>'),
  '你好，世界。',
  '成对 <think> 在末尾：只保留正文'
);
assertEqual(
  cleanModelOutput('前半句。<think>多行\n思考内容\n再换行</think>后半句。'),
  '前半句。后半句。',
  '成对多行 <think>：整块（含内部换行）被移除，两侧正文合并'
);
assertEqual(
  cleanModelOutput('<think>\n  \n</think>'),
  '<think>\n  \n</think>',
  '纯 think 块：删空后按防空策略回退原文（避免返回空内容）'
);

// ---------- 孤立 </think>（截断残留） ----------
assertEqual(
  cleanModelOutput('</think>很高兴认识你。'),
  '很高兴认识你。',
  '孤立 </think> 在开头：仅删标签不删正文'
);
assertEqual(
  cleanModelOutput('第一句。</think>第二句。'),
  '第一句。第二句。',
  '孤立 </think> 在中间：仅删标签，正文完好拼接'
);
assertEqual(
  cleanModelOutput('第一句。</think>'),
  '第一句。',
  '孤立 </think> 在末尾'
);
assertEqual(
  cleanModelOutput('</think></think>\n结果'),
  '结果',
  '多个孤立 </think> 后跟正文：正文保留并去除首尾空白'
);
assertEqual(
  cleanModelOutput('正文 </THINK> 保持大小写混合'),
  '正文  保持大小写混合',
  '孤立 </think> 大小写不敏感'
);

// ---------- 截断的 <think>（只有开标签，无闭合） ----------
assertEqual(
  cleanModelOutput('<think>这段思考被截断，没有闭合标签'),
  '这段思考被截断，没有闭合标签',
  '截断开标签：删除标签本身，不误删其后思考文字（尽力而为）'
);
assertEqual(
  cleanModelOutput('<think>思考中...'),
  '思考中...',
  '截断开标签：同上'
);

// ---------- 其他推理标签变体 ----------
assertEqual(
  cleanModelOutput('<reasoning>推理过程</reasoning>最终答案'),
  '最终答案',
  '成对 <reasoning> 块被移除'
);
assertEqual(
  cleanModelOutput('结果 <thinking>内部的思考</thinking> 出来了'),
  '结果  出来了',
  '成对 <thinking> 块被移除，正文保留'
);
assertEqual(
  cleanModelOutput('<THINK>大写思考</THINK>正文大写场景'),
  '正文大写场景',
  '成对大写 <THINK> 被移除（gi 标志）'
);
assertEqual(
  cleanModelOutput('<thought>一二三</thought>内容'),
  '内容',
  '成对 <thought> 变体'
);
assertEqual(
  cleanModelOutput('<analysis>数据</analysis>结论'),
  '结论',
  '成对 <analysis> 变体'
);
assertEqual(
  cleanModelOutput('[thinking]思考[/thinking]方括号正文'),
  '方括号正文',
  '成对 [thinking] 方括号块被移除'
);
assertEqual(
  cleanModelOutput('正文[/reasoning]残留方括号'),
  '正文残留方括号',
  '孤立 [/reasoning] 被移除，正文保留'
);

// ---------- 不会误删正文 ----------
assertEqual(
  cleanModelOutput('I think this is a great idea.'),
  'I think this is a great idea.',
  '正文含英文单词 think（无标签）：原样保留'
);
assertEqual(
  cleanModelOutput('我在思考 think about it 的问题。'),
  '我在思考 think about it 的问题。',
  '正文含中文"思考"与 think：原样保留'
);
assertEqual(
  cleanModelOutput('<strong>加粗内容</strong> 保留 HTML 标签'),
  '<strong>加粗内容</strong> 保留 HTML 标签',
  '正文真正的 HTML 标签（strong）不被误删'
);
assertEqual(
  cleanModelOutput('  response正在执行 tasks 并逐步处理节点，最后应用翻译。  '),
  'response正在执行 tasks 并逐步处理节点，最后应用翻译。',
  '普通正文（response/处理节点 等词）不受影响，仅去首尾空格'
);

// ---------- 常规行为 ----------
assertEqual(
  cleanModelOutput('纯文本没有标签，带空格  '),
  '纯文本没有标签，带空格',
  '纯文本：仅去除首尾空格'
);
assertEqual(
  cleanModelOutput('<think>只有思考没有正文</think>'),
  '<think>只有思考没有正文</think>',
  '只剩 think 块：删空后回退原文（防空策略，不返回空串）'
);
assertEqual(
  cleanModelOutput(''),
  '',
  '空字符串：返回空'
);
assertEqual(
  cleanModelOutput(undefined),
  undefined,
  'undefined：原样返回'
);
assertEqual(
  cleanModelOutput(null),
  null,
  'null：原样返回'
);

// ---------- 组合场景 ----------
assertEqual(
  cleanModelOutput('<think>思考\n内容</think>\n</think>\n真正需要翻译的句子。'),
  '真正需要翻译的句子。',
  '完整块 + 孤立闭合标签混合：最终只留下正文'
);
assertEqual(
  cleanModelOutput('<thinking>a</thinking>第一段 <think>b</think>第二段'),
  '第一段 第二段',
  '多个成对块混合：正文均保留'
);
assertEqual(
  cleanModelOutput('第一句\n<think>\n思考内容\n</think>\n第二句'),
  '第一句\n\n第二句',
  '成对块横跨多行，正文保留换行结构'
);

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  process.exit(1);
}
