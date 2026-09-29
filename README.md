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
3. Click the extension's toolbar icon to open settings, fill in your model and/or a Gemini key, set the target language, **Save**.
4. Reload any tabs that were already open, then double-click a word.

If nothing appears: the page console shows content-script errors, and `chrome://extensions` → the extension's **service worker** link shows the request log (`translate: …` / `result: …` / `failed: …`).

## Providers

Both are plain OpenAI-compatible `/v1/chat/completions` servers — Gemini included, through Google's OpenAI layer — so there is one setting block each and one code path behind them.

- **Your model** — base URL, model, optional key. vLLM `:8000`, Ollama `:11434`, LM Studio `:1234`, OpenRouter, OpenAI, anything that speaks the protocol. Tried first. Leave **Model** empty to skip it and always use Gemini.
- **Gemini** — just an API key (and the model name). Used when your model is unreachable, slower than the timeout, or returns a 5xx; the popup then says "via Gemini". Leave the key empty to use only your own model.

A **4xx is not a fallback**: a wrong model name or bad key shows as an error in the popup, otherwise a typo would silently route every lookup to Gemini forever.

Each server is asked not to "think", since reasoning costs ~44s per lookup on Qwen3/vLLM and ~6s on Gemini without changing the answer. They name that switch differently and reject each other's, so the worker tries `chat_template_kwargs` (vLLM, Ollama, LM Studio), then `reasoning_effort` (Google, OpenAI), then neither — and remembers what each base URL accepted. Measured: Gemini 6.5s → **0.9s**, `Qwen/Qwen3.6-27B` on vLLM ~3s.

Everything else lives under **Advanced**: request timeout, temperature (empty sends no value — some models accept only their own default), and the two prompts.

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
- `background.js` — service worker; makes all LLM requests, one `chat()` for every provider.
- `settings.js` — defaults shared by background and options page, including both prompt templates.
- `options.html` / `options.js` — settings UI. Keys are stored in `chrome.storage.local` (not synced).

## Limitations

- Top-level frame only (no iframes).
- Selections in inputs, textareas and editable content are ignored, as are selections over 600 characters.
- Keyboard selections (shift+arrows) don't trigger it — the trigger is `mouseup`.
