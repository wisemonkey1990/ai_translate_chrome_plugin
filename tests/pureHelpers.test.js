// content.js 中纯函数的单元测试：isMeaningfulText / estimateEntryBytes。
// 直接从源码提取真实函数执行，避免与实现脱节。
// 运行: node tests/pureHelpers.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

// 抽取从 marker 到第一个顶层平衡 "}" 之间的完整函数文本
function extractFunction(source, marker) {
  const idx = source.indexOf(marker);
  if (idx < 0) {
    console.error(`错误: 未在 content.js 中找到 ${marker}`);
    process.exit(1);
  }
  let depth = 0;
  for (let i = idx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(idx, i + 1);
    }
  }
  console.error(`错误: 未能提取 ${marker} 的完整函数体`);
  process.exit(1);
}

const sandbox = { TextEncoder, JSON, console };
vm.createContext(sandbox);
vm.runInContext(extractFunction(src, 'function isMeaningfulText(text) {'), sandbox);
vm.runInContext(extractFunction(src, 'function estimateEntryBytes(key, value) {'), sandbox);

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// isMeaningfulText
assert('普通文本可翻译', sandbox.isMeaningfulText('Hello world') === true);
assert('空白不可翻译', sandbox.isMeaningfulText('   ') === false);
assert('单字符不可翻译', sandbox.isMeaningfulText('A') === false);
assert('纯数字不可翻译', sandbox.isMeaningfulText('12345') === false);
assert('带空格纯数字不可翻译', sandbox.isMeaningfulText('  42  ') === false);
assert('数字加字母可翻译', sandbox.isMeaningfulText('Room 12') === true);
assert('两个字符可翻译', sandbox.isMeaningfulText('OK') === true);

// estimateEntryBytes
const bytesAscii = sandbox.estimateEntryBytes('k', { text: 'ab', translation: 'cd', ts: 1 });
assert('ASCII 估算为正数', bytesAscii > 0);
const bytesCjk = sandbox.estimateEntryBytes('transCache:zh-CN:abc', { text: '你好', translation: '你好世界', ts: 1 });
assert('CJK 比 ASCII 占更多字节', bytesCjk > bytesAscii);
assert('key 越长估算越大',
  sandbox.estimateEntryBytes('longer-key-xxxxx', { a: 1 }) > sandbox.estimateEntryBytes('k', { a: 1 }));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exit(1);
