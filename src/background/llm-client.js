// OpenAI 兼容 /chat/completions 接口的调用封装
// 依赖: constants.js

// 清洗模型输出中夹带的思维链/推理标签（如 <think>...</think>、<reasoning> 等）
function cleanModelOutput(text) {
  if (!text) return text;

  let cleaned = String(text);

  // 1. 移除成对的思维链块（含换行内容）
  cleaned = cleaned.replace(/<\s*(think|thinking|reasoning|analysis|thought)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');

  // 2. 移除成对的 [thinking]/[reasoning] 块（部分服务使用方括号形式）
  cleaned = cleaned.replace(/\[\s*(thinking|reasoning|analysis|thought)\s*\][\s\S]*?\[\s*\/\s*\1\s*\]/gi, '');

  // 3. 移除残留的单个开/闭标签（可能被截断导致的孤立 </think>）
  cleaned = cleaned.replace(/<\s*\/?\s*(think|thinking|reasoning|analysis|thought)\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/\[\s*\/?\s*(thinking|reasoning|analysis|thought)\s*\]/gi, '');

  cleaned = cleaned.trim();

  // 若全部被清空，退回原始文本，避免返回空内容
  return cleaned || String(text).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 发送 API 请求并对可重试错误做指数退避重试：
// - 429 与 5xx：最多重试 2 次，退避时间随次数翻倍（429 用更长间隔）
// - 网络异常：同样退避重试
// 返回已成功的 response；重试耗尽后抛出带状态码的错误（content 侧据此限流回退）
async function fetchWithRetry(apiUrl, requestBody, config, maxAttempts = 3) {
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
    } catch (netError) {
      lastError = netError;
      if (attempt < maxAttempts - 1) {
        await sleep(1500 * Math.pow(2, attempt));
        continue;
      }
      break;
    }

    if (response.ok) {
      return response;
    }

    const errorData = await response.json().catch(() => ({}));
    const message = `API错误 (${response.status}): ${errorData.error?.message || response.statusText}`;
    const retriable = response.status === 429 || response.status >= 500;

    if (retriable && attempt < maxAttempts - 1) {
      const baseDelay = response.status === 429 ? 1500 : 800;
      await sleep(baseDelay * Math.pow(2, attempt));
      continue;
    }

    // 重试耗尽：抛出携带状态码的错误，content 侧可据此做并发回退
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  throw new Error(lastError ? `网络请求失败: ${lastError.message}` : 'API请求失败');
}

// 调用 chat/completions 并返回清洗后的回复文本
async function requestChatCompletion(config, messages, temperature, label) {
  if (!isApiConfigComplete(config)) {
    throw new Error('API配置不完整，请在选项页面中设置API信息');
  }

  const apiUrl = buildChatCompletionsUrl(config.apiBaseUrl);
  const requestBody = { model: config.apiModel, messages, temperature };

  if (config.debugMode) {
    console.log(`${label} request:`, { url: apiUrl, body: requestBody });
  }

  const response = await fetchWithRetry(apiUrl, requestBody, config);
  const data = await response.json();

  if (config.debugMode) {
    console.log(`${label} response:`, data);
  }

  const content = data.choices?.[0]?.message?.content;
  if (content === undefined) {
    throw new Error('API响应格式不正确');
  }
  return cleanModelOutput(content);
}
