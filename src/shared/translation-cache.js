// 跨会话翻译缓存（chrome.storage.local）：content script 读写，options 页面查看/清空
// 依赖: constants.js, storage.js

// 简单文本哈希（非加密用途，仅用于生成缓存 key）
function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// 缓存 key：目标语言 + 原文哈希
function translationCacheKey(text, targetLang) {
  return `${TRANSLATION_CACHE_PREFIX}${targetLang}:${hashText(text)}`;
}

function isCacheableText(text) {
  return text.length >= 2 && text.length <= MAX_CACHEABLE_TEXT_LENGTH;
}

// 把用户配置的容量（MB）规整到允许范围，非法值回退默认
function normalizeCacheLimitMB(value) {
  const mb = Number(value);
  return Number.isFinite(mb) && mb >= MIN_CACHE_LIMIT_MB && mb <= MAX_CACHE_LIMIT_MB
    ? mb
    : DEFAULT_CACHE_LIMIT_MB;
}

async function getTranslationCacheLimitBytes() {
  try {
    const result = await syncGet(['translationCacheLimitMB']);
    return normalizeCacheLimitMB(result.translationCacheLimitMB) * 1024 * 1024;
  } catch (error) {
    return DEFAULT_CACHE_LIMIT_MB * 1024 * 1024;
  }
}

// 返回未过期的缓存译文；不存在、原文不符或已过期返回 null（过期条目顺便删除）
async function readCachedTranslation(text, targetLang, now = Date.now()) {
  if (!isCacheableText(text)) return null;
  const key = translationCacheKey(text, targetLang);
  const entry = (await localGet(key))[key];
  if (!entry || entry.text !== text) return null;
  if (now - (entry.ts || 0) < CACHE_TTL_MS) {
    return entry.translation;
  }
  localRemove(key).catch(() => {});
  return null;
}

async function writeCachedTranslation(text, targetLang, translation, now = Date.now()) {
  if (!isCacheableText(text)) return;
  const key = translationCacheKey(text, targetLang);
  await localSet({ [key]: { text, translation, ts: now } });
}

async function getTranslationCacheEntries() {
  const allData = await localGet(null);
  return Object.keys(allData)
    .filter(key => key.startsWith(TRANSLATION_CACHE_PREFIX))
    .map(key => ({ key, ts: Number(allData[key]?.ts) || 0 }));
}

async function getTranslationCacheUsageBytes() {
  const entries = await getTranslationCacheEntries();
  return localGetBytesInUse(entries.map(entry => entry.key));
}

// 按时间淘汰最旧条目，确保缓存不超过容量上限
async function trimTranslationCache(limitBytes) {
  if (!limitBytes) return;
  const entries = await getTranslationCacheEntries();
  let remainingKeys = entries.map(entry => entry.key);
  let usage = await localGetBytesInUse(remainingKeys);
  if (usage <= limitBytes) return;

  entries.sort((a, b) => a.ts - b.ts);
  for (const entry of entries) {
    if (usage <= limitBytes) break;
    await localRemove(entry.key);
    remainingKeys = remainingKeys.filter(key => key !== entry.key);
    usage = await localGetBytesInUse(remainingKeys);
  }
}

async function clearTranslationCache() {
  const keys = (await getTranslationCacheEntries()).map(entry => entry.key);
  if (keys.length > 0) {
    await localRemove(keys);
  }
}
