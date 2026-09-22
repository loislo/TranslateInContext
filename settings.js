// Shared by background.js (via importScripts) and options.html.

// {{lang}} is replaced with the target language when the request is built.
const DEFAULT_WORD_PROMPT = `You are a dictionary. The user selected a word or short phrase on a web page. \
Translate it into {{lang}} as it is used in the given sentence, and describe it as a dictionary entry. \
If the sentence puts a separable prefix elsewhere (German trennbare Verben, e.g. "fährt … ab", \
or the selection is that prefix), the entry is the whole verb: translate "abfahren", not "fahren". \
Reply with only a JSON object, no markdown:
{"translation": "<the selected word translated into {{lang}}, in the form that fits the sentence>",
 "lemma": "<the word's dictionary form in its own language, with its article if that language has them, e.g. \\"der Fluss\\">",
 "forms": "<part of speech and the main forms in the word's own language, e.g. \\"noun, pl. die Flüsse\\" or \\"verb, ging, gegangen\\"; \\"\\" if there is nothing useful>",
 "synonyms": ["<up to 3 synonyms in the word's own language for the meaning it has in this sentence, in dictionary form; [] if none>"],
 "note": "<one short sentence in {{lang}} explaining what the word means in this sentence>",
 "other": ["<up to 3 other common meanings of the word, translated into {{lang}}, most common first; [] if none>"]}`;

const DEFAULT_PASSAGE_PROMPT = `You translate text that the user selected on a web page into {{lang}}. \
Translate the whole selection, naturally, keeping its tone. \
Reply with only a JSON object, no markdown:
{"translation": "<the whole selection translated into {{lang}}>",
 "note": "<one short sentence in {{lang}} about an idiom or tricky wording in it, or \\"\\" if there is nothing worth noting>"}`;

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
  wordPrompt: DEFAULT_WORD_PROMPT,
  passagePrompt: DEFAULT_PASSAGE_PROMPT,
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
