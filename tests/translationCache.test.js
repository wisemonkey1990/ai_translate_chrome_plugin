// 翻译缓存单元测试：读写、过期、容量整理、清空
// 运行: node tests/translationCache.test.js

const { loadScripts, createChecker, createChromeStorageMock } = require('./helpers/load-scripts');

const { check, finish } = createChecker();

function load(local = {}, sync = {}) {
  const chrome = createChromeStorageMock(local, sync);
  const ctx = loadScripts(
    ['src/shared/constants.js', 'src/shared/storage.js', 'src/shared/translation-cache.js'],
    { chrome }
  );
  return { ctx, chrome };
}

(async () => {
  // 1. 写入后可读出；不同语言互不干扰
  {
    const { ctx } = load();
    await ctx.writeCachedTranslation('Hello world', 'zh-CN', '你好世界', 1000);
    check('命中缓存', await ctx.readCachedTranslation('Hello world', 'zh-CN', 2000) === '你好世界');
    check('其他目标语言未命中', await ctx.readCachedTranslation('Hello world', 'ja', 2000) === null);
    check('缓存 key 带前缀和语言', ctx.translationCacheKey('Hello world', 'zh-CN').startsWith('transCache:zh-CN:'));
  }

  // 2. 过期条目返回 null 并被删除
  {
    const { ctx, chrome } = load();
    const ttl = ctx.get('CACHE_TTL_MS');
    await ctx.writeCachedTranslation('Old text', 'en', 'old', 0);
    check('过期缓存未命中', await ctx.readCachedTranslation('Old text', 'en', ttl + 1) === null);
    await new Promise(r => setImmediate(r));
    check('过期缓存被删除', Object.keys(chrome.storage.local.data).length === 0);
  }

  // 3. 过短/过长文本不入缓存
  {
    const { ctx, chrome } = load();
    await ctx.writeCachedTranslation('a', 'en', 'x');
    await ctx.writeCachedTranslation('y'.repeat(ctx.get('MAX_CACHEABLE_TEXT_LENGTH') + 1), 'en', 'x');
    check('过短/过长文本不写缓存', Object.keys(chrome.storage.local.data).length === 0);
  }

  // 4. 超出容量时按时间淘汰最旧条目，且不动非缓存数据
  {
    const { ctx, chrome } = load({ otherSetting: 'keep' });
    for (let i = 0; i < 5; i++) {
      await ctx.writeCachedTranslation(`text number ${i}`, 'en', 'translation '.repeat(5), 100 + i);
    }
    const oneEntryBytes = await ctx.localGetBytesInUse([ctx.translationCacheKey('text number 0', 'en')]);
    await ctx.trimTranslationCache(oneEntryBytes * 2);
    const keys = Object.keys(chrome.storage.local.data);
    check('整理后只保留最新的 2 条', keys.filter(k => k.startsWith('transCache:')).length === 2);
    check('保留的是最新条目', await ctx.readCachedTranslation('text number 4', 'en', 200) !== null &&
      await ctx.readCachedTranslation('text number 0', 'en', 200) === null);
    check('非缓存数据不受影响', chrome.storage.local.data.otherSetting === 'keep');
  }

  // 5. 清空缓存
  {
    const { ctx, chrome } = load({ otherSetting: 'keep' });
    await ctx.writeCachedTranslation('Some text', 'en', 'x');
    await ctx.clearTranslationCache();
    check('清空后只剩非缓存数据', Object.keys(chrome.storage.local.data).join() === 'otherSetting');
    check('清空后占用为 0', await ctx.getTranslationCacheUsageBytes() === 0);
  }

  // 6. 容量配置规整
  {
    const { ctx } = load({}, { translationCacheLimitMB: 3 });
    check('读取有效容量配置', await ctx.getTranslationCacheLimitBytes() === 3 * 1024 * 1024);
    check('非法容量回退默认', ctx.normalizeCacheLimitMB(50) === 8 && ctx.normalizeCacheLimitMB('x') === 8);
  }

  finish();
})();
