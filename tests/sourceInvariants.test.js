// 源码不变式测试：守护几个容易回退的关键修复点。
// 这些行为难以在 node 里完整模拟（涉及 chrome.* 与网络），因此用源码断言兜底。
// 运行: node tests/sourceInvariants.test.js

const fs = require('fs');
const path = require('path');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8');

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

// temperature=0 不应被 || 吞掉
assert('translateText 使用 ?? 处理 temperature', background.includes('config.temperature ?? 0.3'));
assert('不再使用 config.temperature || 0.3', !background.includes('config.temperature || 0.3'));

// 安全：绝不把 apiKey 下发给 content script
const getApiConfigIdx = background.indexOf("request.action === 'getApiConfig'");
assert('存在 getApiConfig 处理分支', getApiConfigIdx >= 0);
const handlerSlice = background.slice(getApiConfigIdx, getApiConfigIdx + 900);
assert('getApiConfig 只读取白名单字段', handlerSlice.includes("chrome.storage.sync.get(['enablePageSummary', 'debugMode']"));
assert('getApiConfig 不再整体回传 config: result', !handlerSlice.includes('config: result'));
assert('getApiConfig 不读取 result.apiKey', !handlerSlice.includes('result.apiKey'));
assert('getApiConfig 不在返回体中放入 apiKey 字段', !/apiKey\s*:/.test(handlerSlice));

// 已删除重复的 i18n 消息处理分支
assert('background 不再处理 getI18nMessage', !background.includes("request.action === 'getI18nMessage'"));

// manifest：内容脚本一起注入 i18n.js，且移除无用的 web_accessible_resources
assert('content_scripts 注入 i18n.js', /"js":\s*\[\s*"i18n\.js"\s*,\s*"content\.js"\s*\]/.test(manifest));
assert('移除 web_accessible_resources', !manifest.includes('web_accessible_resources'));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) process.exit(1);
