// 测试辅助：在同一个 vm 上下文中按顺序加载扩展的普通脚本（与浏览器中 <script>/content_scripts 的加载方式一致）
// 用法: const ctx = loadScripts(['src/shared/constants.js', ...], { window: {...} });
//       ctx.get('someConst') 可读取脚本中的顶层 const/let

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function loadScripts(files, globals = {}) {
  const sandbox = { console, setTimeout, clearTimeout, Promise, ...globals };
  vm.createContext(sandbox);
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  // 顶层 const/let 不会挂到 sandbox 上，通过表达式求值读取
  sandbox.get = (name) => vm.runInContext(name, sandbox);
  return sandbox;
}

// 极简断言计数器，保持与既有测试一致的输出格式
function createChecker() {
  let passed = 0;
  let failed = 0;
  return {
    check(name, cond) {
      if (cond) {
        passed++;
      } else {
        failed++;
        console.error(`✗ ${name}`);
      }
    },
    finish() {
      console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
      if (failed > 0) process.exit(1);
    }
  };
}

// 内存版 chrome.storage，用于测试缓存与配置读写
function createChromeStorageMock(initialLocal = {}, initialSync = {}) {
  function area(data) {
    const pick = (keys) => {
      if (keys === null || keys === undefined) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      list.forEach(k => { if (k in data) out[k] = data[k]; });
      return out;
    };
    return {
      data,
      get: (keys, cb) => cb(pick(keys)),
      set: (items, cb) => { Object.assign(data, items); cb && cb(); },
      remove: (keys, cb) => {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete data[k]);
        cb && cb();
      },
      getBytesInUse: (keys, cb) => {
        const obj = pick(keys);
        cb(Object.keys(obj).reduce((sum, k) => sum + k.length + JSON.stringify(obj[k]).length, 0));
      }
    };
  }
  return {
    runtime: { lastError: undefined },
    storage: { local: area({ ...initialLocal }), sync: area({ ...initialSync }) }
  };
}

module.exports = { loadScripts, createChecker, createChromeStorageMock, ROOT };
