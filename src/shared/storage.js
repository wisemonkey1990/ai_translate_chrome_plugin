// chrome.storage 的 Promise 封装：统一把 chrome.runtime.lastError 转成 reject

function promisifyChromeCall(invoke) {
  return new Promise((resolve, reject) => {
    try {
      invoke((result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function syncGet(keys) {
  return promisifyChromeCall(done => chrome.storage.sync.get(keys, done)).then(result => result || {});
}

function syncSet(items) {
  return promisifyChromeCall(done => chrome.storage.sync.set(items, done));
}

function syncRemove(keys) {
  return promisifyChromeCall(done => chrome.storage.sync.remove(keys, done));
}

function localGet(keys) {
  return promisifyChromeCall(done => chrome.storage.local.get(keys, done)).then(result => result || {});
}

function localSet(items) {
  return promisifyChromeCall(done => chrome.storage.local.set(items, done));
}

function localRemove(keys) {
  return promisifyChromeCall(done => chrome.storage.local.remove(keys, done));
}

function localGetBytesInUse(keys) {
  if (Array.isArray(keys) && keys.length === 0) return Promise.resolve(0);
  return promisifyChromeCall(done => chrome.storage.local.getBytesInUse(keys, done)).then(bytes => bytes || 0);
}

// 读取 API 与翻译相关配置
function getApiConfig() {
  return syncGet(API_CONFIG_KEYS);
}
