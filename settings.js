// Shared by background.js (via importScripts) and options.html.

const DEFAULT_SETTINGS = {
  // Primary: an OpenAI-compatible server (vLLM, Ollama, LM Studio, ...). Empty model = not configured.
  openaiBaseUrl: 'http://family:9999/v1',
  openaiKey: '',
  openaiModel: 'Qwen/Qwen3.6-27B',
  primaryTimeoutSec: 10,
  // Fallback: used when the primary is unreachable, times out, or fails with a server error.
  fallbackToGemini: true,
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  targetLang: uiLanguageName(),
};

// A locale tag Intl can't parse must not break this script: it is the whole extension's startup path.
function uiLanguageName() {
  try {
    const lang = new Intl.Locale(chrome.i18n.getUILanguage()).language;
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);
  } catch {
    return 'English';
  }
}

function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}
