// buildTranslationUnits 单元测试
// 直接从 content.js 提取真实函数定义执行，避免与源码脱节。
// 运行: node tests/buildTranslationUnits.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MARKER = 'function buildTranslationUnits(textNodes, maxChars = 200) {';
const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

const idx = src.indexOf(MARKER);
if (idx < 0) {
  console.error('错误: 未在 content.js 中找到 buildTranslationUnits 定义');
  process.exit(1);
}

let fn = src.slice(idx);
let depth = 0;
let end = -1;
for (let i = 0; i < fn.length; i++) {
  const ch = fn[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
fn = fn.slice(0, end);

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fn + '\n;globalThis.buildTranslationUnits = buildTranslationUnits;', sandbox);
const build = sandbox.buildTranslationUnits;

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${name}`);
  }
}

// 构造伪文本节点（只使用 buildTranslationUnits 用到的字段）
function makeNode(id, text, parent, prev) {
  return { id, textContent: text, parentNode: parent, previousSibling: prev || null };
}

// 同父连续短句应合并
{
  const parent = { id: 'p1' };
  const a = makeNode('a', 'Hello ', parent);
  const b = makeNode('b', 'world', parent, a);
  const c = makeNode('c', '!', parent, b);
  const d = makeNode('d', 'Second para.', { id: 'p2' });
  const units = build([a, b, c, d]);
  check('同父相邻 3 节点合并为 1 单元，跨父为 2 单元', units.length === 2);
  check('第 1 单元含全部 3 个相邻节点', units[0].nodes.length === 3);
  check('合并原文顺序拼接正确', units[0].original === 'Hello world!');
  check('独立父节点自成单元', units[1].nodes.length === 1 && units[1].original === 'Second para.');
}

// 中间被其他节点隔开的不合并
{
  const parent = { id: 'p3' };
  const e = makeNode('e', 'left', parent);
  const gap = makeNode('gap', 'x', parent, e);
  const f = makeNode('f', 'right', parent, gap);
  const units = build([e, f]);
  check('隔开的两个文本节点不合并', units.length === 2);
}

// 合并后超过 maxChars 则另起单元
{
  const parent = { id: 'p4' };
  const l1 = makeNode('l1', 'x'.repeat(150), parent);
  const l2 = makeNode('l2', 'y'.repeat(150), parent, l1);
  const units = build([l1, l2], 200);
  check('合并后超长自动拆分为两个单元', units.length === 2);
}

// 单元对象结构完整
{
  const parent = { id: 'p5' };
  const s1 = makeNode('s1', 'a', parent);
  const units = build([s1], 200);
  check('单元含 translated 空字段待填充', units[0].translated === '');
  check('单元节点引用保持原对象', units[0].nodes[0] === s1);
}

// 单节点不合并也自成单元
{
  const units = build([makeNode('only', 'only node', { id: 'p6' })], 200);
  check('单个节点自成单元', units.length === 1 && units[0].original === 'only node');
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  process.exit(1);
}
