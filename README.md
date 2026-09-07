# AI Web Translator

English | [简体中文](README_CN.md)

This repository publishes a derivative, unpacked Manifest V3 Chrome extension for translating webpages with OpenAI-compatible Large Language Model (LLM) APIs.

> **Upstream and attribution**: This is not an original project. It is based on and extended from [jxzhangaoran/ai_translate_chrome_plugin](https://github.com/jxzhangaoran/ai_translate_chrome_plugin). The work in this repository focuses on communication fixes, translation performance, background progress, export tools, cache controls, tests, and documentation. This repository is not affiliated with or endorsed by the upstream project or its author.

## Project and Release Notice

This repository publishes a modified derivative of the upstream project named above, not a new independent implementation. Changes are maintained in this repository as separate commits and should be reviewed together with the upstream project before redistribution. Please respect any applicable upstream license, attribution requirements, and third-party API terms.

## Highlights

- Translate the current webpage with one click.
- Continue translating in the background after the popup closes.
- Render each completed translation progressively instead of waiting for the whole page.
- Prioritize content near the viewport so visible text appears first.
- Use up to six concurrent translation workers with automatic backoff for rate limits and server errors.
- Merge adjacent short text nodes and reuse identical in-flight requests to reduce API calls.
- Optionally summarize page context without blocking the first translations.
- Toggle between the original and translated page from a floating toolbar.
- Download an original/translation comparison as a Markdown file.
- Remove common model reasoning tags such as `<think>...</think>` from results.
- Configure API endpoint, model, temperature, formatting behavior, context summary, and system prompt.
- Cache successful translations locally with a configurable 1-10 MB limit and 30-day expiration.
- Clear the translation cache manually and inspect current cache usage.

## Screenshots

### Popup

![Extension Popup](./screenshots/en/popup.png)

### Settings

![Settings Page](./screenshots/en/options.png)

### Translation

![Original Page](./screenshots/en/original1.png)
![Translated Page](./screenshots/en/translate1.png)

## Installation

This project is currently distributed as an unpacked extension.

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository directory.

After changing source files, click **Reload** on the extension card. Reload the webpage before testing content-script changes.

## Configuration

Open the extension popup and click **Settings**. Configure:

- **API Base URL**: the base URL of an OpenAI-compatible API, without the final `/chat/completions` path.
- **Model**: the model name accepted by the selected API provider.
- **API Key**: stored in Chrome extension storage and never included in this repository.
- **Temperature** and formatting options.
- **Page summary**: optional context generation. It runs in parallel and does not block the first translations.
- **System prompt**: optional translation instructions.
- **Translation cache limit**: between 1 MB and 10 MB.

The extension sends webpage text to the API endpoint configured by the user. Do not use an endpoint or model that you do not trust.

## Usage

1. Open a webpage that permits content scripts.
2. Open the extension popup and choose a target language.
3. Click **Translate Page**.
4. The popup closes after translation starts; translation continues on the page.
5. Watch progress in the page overlay or extension badge.
6. Use the floating toolbar to switch between **View Original / View Translation** or click **Download Comparison**.

The extension cannot run on browser-internal pages such as `chrome://` pages or the Chrome Web Store. For local files, enable **Allow access to file URLs** in the extension details page.

## Performance Design

- **Viewport-first scheduling**: visible and nearby units are placed at the front of the queue.
- **Translation units**: adjacent direct text nodes are combined up to 200 characters.
- **In-flight deduplication**: identical text shares the same pending request.
- **Persistent cache**: successful results are reused across page reloads and browser sessions.
- **Adaptive concurrency**: 429 and 5xx responses reduce concurrency and trigger exponential cooldown; concurrency recovers after the API stabilizes.
- **Progressive rendering**: each completed unit is written to the DOM immediately.

## Project Structure

```text
background.js   MV3 service worker, API requests, retries, output cleanup, badge progress
content.js      DOM scanning, viewport scheduling, translation, toolbar, download, cache
popup.html/js   Extension popup and translation controls
options.html/js Settings and cache management
tests/          Node-based regression tests
manifest.json   Chrome extension manifest
```

## Development and Tests

No package installation is required for the current tests. Run them from the repository root:

```bash
node --check background.js
node --check content.js
node --check options.js
node tests/cleanModelOutput.test.js
node tests/buildTranslationUnits.test.js
node tests/orderUnitsByViewport.test.js
node tests/fetchWithRetry.test.js
```

The tests cover reasoning-tag cleanup, text-unit merging, viewport ordering, and retry behavior. Browser-level verification should be performed by loading the unpacked extension in Chrome.

## Privacy and Security

- No API key is hard-coded in the source tree.
- API keys and preferences are stored in Chrome extension storage.
- Translation requests are sent only to the API Base URL configured by the user.
- Webpage content is processed only after the user starts translation.
- Translation cache is stored locally in `chrome.storage.local` and can be cleared from Settings.
- Because the extension uses `<all_urls>`, review the source and API configuration before installing it.

## Limitations

- The extension depends on the response format of an OpenAI-compatible `/chat/completions` endpoint.
- Translation quality, latency, and rate limits depend on the selected model and provider.
- Dynamic content added after translation is not automatically guaranteed to be translated.
- Complex pages with heavily customized DOM behavior may require provider-specific or site-specific adjustments.

## Contributing

Issues and pull requests are welcome. Please include:

- A clear description of the problem or proposed change.
- Reproduction steps for bug reports.
- Relevant browser console or service-worker errors with secrets removed.
- Tests for changes to pure logic where practical.

Never commit API keys, cookies, access tokens, private webpages, or other credentials.
