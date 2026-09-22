# Translate in Context

Chrome extension: double-click a word — or drag-select a phrase — on any page, and an LLM translates it using the sentence it appears in. A selection that starts or ends mid-word is grown to whole words. The popup shows a small dictionary entry:

```
Ufer
берегу                        ← translation as used in this sentence
das Ufer · noun, pl. die Ufer ← dictionary form, article, key forms
Обозначает берег реки.        ← what it means here
also: набережная, причал, береговая линия
```

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Click the extension's toolbar icon to open settings, pick a provider, set the target language, **Save**.
4. Reload any tabs that were already open, then double-click a word.

If nothing appears: the page console shows content-script errors, and `chrome://extensions` → the extension's **service worker** link shows the request log (`translate: …` / `result: …` / `failed: …`).

## Providers

Your own server is tried first, Gemini catches the cases where it isn't there.

- **Your server** — any OpenAI-compatible `/v1/chat/completions` endpoint. Defaults to `http://family:9999/v1` with `Qwen/Qwen3.6-27B` (vLLM), which answers in 2–3s. Others: Ollama `:11434/v1`, LM Studio `:1234/v1`, OpenRouter, OpenAI. API key optional. Leave **Model** empty to skip the server and always use Gemini.
  - Every request sends `chat_template_kwargs: {enable_thinking: false}`: on that Qwen3 server, reasoning costs ~44s per lookup versus ~1s without it, for the same answer. Ollama and LM Studio ignore the flag; the official OpenAI API rejects unknown fields, so it isn't usable as the server without dropping that line from `background.js`.
- **Gemini fallback** — key from https://aistudio.google.com/apikey, default model `gemini-2.5-flash`.

The fallback fires when the server is unreachable, answers slower than the timeout (default 10s), or returns a 5xx. It deliberately does **not** fire on 4xx — a wrong model name or bad key shows up as an error in the popup instead of silently routing everything to Gemini forever. When a translation came from the fallback, the popup says "via Gemini".

### Ollama

Ollama rejects requests from browser extensions unless the origin is allowed:

```sh
OLLAMA_ORIGINS='chrome-extension://*' ollama serve
# or, for the macOS app:
launchctl setenv OLLAMA_ORIGINS 'chrome-extension://*'   # then restart Ollama
```

Very small models (e.g. `llama3.2` 3B) produce visibly broken translations; `qwen3-vl:8b` was the smallest model that translated correctly in testing.

## Prompts

Both prompts are editable in the options page. `{{lang}}` is replaced with the target language, and each has a **Reset to default** button; an empty box falls back to the built-in prompt.

- **Word or short phrase (1–3 words)** — asks for the dictionary entry: `translation`, `lemma`, `forms`, `synonyms`, `note`, `other`. It also tells the model that a German separable prefix stranded elsewhere in the sentence belongs to the entry (`fährt … ab` → `abfahren`).
- **Longer selection (4+ words)** — asks for a plain translation of the whole selection plus an optional note.

The popup renders whichever of those JSON keys come back, so keep the key names if you edit the text; anything the model omits is simply not shown.

## Files

- `content.js` — `mouseup` handler (covers both double-click and drag-select), word expansion, sentence extraction (`Intl.Segmenter`), popup (Shadow DOM).
- `background.js` — service worker; makes all LLM requests.
- `settings.js` — defaults shared by background and options page, including both prompt templates.
- `options.html` / `options.js` — settings UI. Keys are stored in `chrome.storage.local` (not synced).

## Limitations

- Top-level frame only (no iframes).
- Selections in inputs, textareas and editable content are ignored, as are selections over 100 characters.
- Keyboard selections (shift+arrows) don't trigger it — the trigger is `mouseup`.
