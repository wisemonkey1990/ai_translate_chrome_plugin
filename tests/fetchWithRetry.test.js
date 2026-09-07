// fetchWithRetry 单元测试
// 从 background.js 尾部提取真实函数，注入 mock fetch / 即时 setTimeout 执行。
// 运行: node tests/fetchWithRetry.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const marker = 'function sleep(ms) {';
const idx = src.indexOf(marker);
if (idx < 0) {
  console.error('错误: 未在 background.js 中找到 fetchWithRetry');
  process.exit(1);
}
const fnSource = src.slice(idx).trim(); // 文件尾正好是 sleep + fetchWithRetry

const config = {};
const body = { model: 'm', messages: [] };

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else { failed++; console.error(`✗ ${name}`); }
}

// 即时 setTimeout：让指数退避立即结束，加快测试
async function runWithResponses(responses) {
  const sandbox = {
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    fetch: () => {
      const next = responses.shift();
      if (next && next.isNetError) {
        return Promise.reject(new Error(next.message || 'network down'));
      }
      return Promise.resolve(next);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSource + '\n;globalThis._fetchWithRetry = fetchWithRetry;', sandbox);
  return {
    run: (attempts) => sandbox._fetchWithRetry('https://api.test/v1/chat/completions', body, config, attempts),
    calls: () => responses.length
  };
}

function okResp() { return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) }; }
function errResp(status, message) {
  return {
    ok: false,
    status,
    statusText: message,
    json: async () => ({ error: { message } })
  };
}

(async () => {
  // 1. 首次请求即成功：只调用一次
  {
    const t = await runWithResponses([okResp()]);
    const res = await t.run(3);
    check('首次成功只请求 1 次', t.calls() === 0 && res.ok === true);
  }

  // 2. 首次 429，重试后成功
  {
    const t = await runWithResponses([errResp(429, 'rate limited'), okResp()]);
    const res = await t.run(3);
    check('429 后重试成功（共 2 次请求）', t.calls() === 0 && res.ok === true);
  }

  // 3. 持续 429 到重试耗尽：抛错且带 status=429
  {
    const t = await runWithResponses([errResp(429, 'limit'), errResp(429, 'limit'), errResp(429, 'limit')]);
    let caught = null;
    try { await t.run(3); } catch (e) { caught = e; }
    check('429 重试耗尽抛错', caught !== null);
    check('错误消息含 429', caught && /\(429\)/.test(caught.message));
    check('错误对象带 status=429', caught && caught.status === 429);
  }

  // 4. 网络错误一次后成功
  {
    const t = await runWithResponses([{ isNetError: true, message: 'offline' }, okResp()]);
    const res = await t.run(3);
    check('网络错误后重试成功（共 2 次尝试）', t.calls() === 0 && res.ok === true);
  }

  // 5. 持续 5xx 到重试耗尽：抛错且带 status=503
  {
    const t = await runWithResponses([errResp(503, 'unavailable'), errResp(503, 'unavailable'), errResp(503, 'unavailable')]);
    let caught = null;
    try { await t.run(3); } catch (e) { caught = e; }
    check('503 重试耗尽抛错', caught !== null && caught.status === 503);
  }

  // 6. 非可重试错误（400）不重试，立即抛出
  {
    const t = await runWithResponses([errResp(400, 'bad request')]);
    let caught = null;
    try { await t.run(3); } catch (e) { caught = e; }
    check('400 不重试立即失败', caught !== null && caught.status === 400 && t.calls() === 0);
  }

  // 7. 持续网络错误直到重试耗尽：抛“网络请求失败”
  {
    const t = await runWithResponses([
      { isNetError: true }, { isNetError: true }, { isNetError: true }
    ]);
    let caught = null;
    try { await t.run(3); } catch (e) { caught = e; }
    check('网络错误重试耗尽抛网络错误', caught !== null && /网络请求失败/.test(caught.message));
  }

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exit(1);
})();
