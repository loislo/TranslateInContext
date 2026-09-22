importScripts('settings.js');

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// All network calls live here: MV3 content scripts are subject to the page's CORS rules.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'translate') return;
  console.log('translate:', msg.word, '|', msg.sentence);
  translate(msg.word, msg.sentence).then(
    (result) => { console.log('result:', result); sendResponse({ ok: true, ...result }); },
    (err) => { console.warn('failed:', err); sendResponse({ ok: false, error: err.message }); },
  );
  return true; // keep the channel open for the async response
});

async function translate(word, sentence) {
  const s = await getSettings();
  // A few words still deserve a dictionary entry; a longer selection wants plain translation.
  const isPassage = word.split(/\s+/).length > 3;
  const template = isPassage
    ? (s.passagePrompt || DEFAULT_PASSAGE_PROMPT)
    : (s.wordPrompt || DEFAULT_WORD_PROMPT);
  const system = template.replaceAll('{{lang}}', s.targetLang);
  const user = isPassage
    ? (sentence === word ? `Text: "${word}"` : `Text: "${word}"\nIt appears in: "${sentence}"`)
    : `Word: "${word}"\nSentence: "${sentence}"`;

  if (!s.openaiModel) return parseResult(await callGemini(s, system, user)); // primary not configured
  try {
    return parseResult(await callOpenAI(s, system, user));
  } catch (err) {
    // A 4xx is a configuration mistake (wrong model name, bad key) — show it instead of hiding
    // the primary behind a fallback that would then be used forever.
    if (!s.fallbackToGemini || (err.status && err.status < 500)) throw err;
    console.warn('primary failed, falling back to Gemini:', err.message);
    try {
      return { ...parseResult(await callGemini(s, system, user)), via: 'Gemini' };
    } catch (fallbackErr) {
      throw new Error(`${err.message} — Gemini fallback also failed: ${fallbackErr.message}`);
    }
  }
}

async function callGemini(s, system, user) {
  if (!s.geminiKey) throw new Error('Set your Gemini API key in the extension options.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.geminiModel)}:generateContent`;
  const data = await postJson(url, { 'x-goog-api-key': s.geminiKey }, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) {
    const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || 'unknown';
    throw new Error(`Gemini returned no text (${reason}).`);
  }
  return text;
}

async function callOpenAI(s, system, user) {
  const url = s.openaiBaseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = s.openaiKey ? { Authorization: `Bearer ${s.openaiKey}` } : {};
  const data = await postJson(url, headers, {
    model: s.openaiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    // Reasoning costs ~44s per lookup on Qwen3/vLLM and changes nothing about the answer.
    chat_template_kwargs: { enable_thinking: false },
  }, s.primaryTimeoutSec * 1000);
  const message = data.choices?.[0]?.message;
  if (!message?.content) {
    // vLLM with a reasoning parser puts thinking in `reasoning` and leaves `content` null.
    throw new Error(message?.reasoning
      ? 'The model answered with reasoning only; it ignored the request not to think.'
      : 'The model returned no text.');
  }
  return message.content;
}

async function postJson(url, headers, body, timeoutMs) {
  const origin = new URL(url).origin;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      // Without this an off-network host hangs on TCP connect for ~75s before the fallback starts.
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError'
      ? `${origin} did not answer within ${timeoutMs / 1000}s.`
      : `Cannot reach ${origin}: ${e.message}`);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status} from ${origin}: ${(await res.text()).slice(0, 300)}`;
    if (res.status === 403 && /localhost|127\.0\.0\.1/.test(origin)) {
      msg += ' (Ollama: set OLLAMA_ORIGINS=chrome-extension://* and restart it.)';
    }
    const err = new Error(msg);
    err.status = res.status; // lets translate() decide whether to fall back
    throw err;
  }
  return res.json();
}

const str = (v) => (v == null ? '' : String(v));
const list = (v) => (Array.isArray(v) ? v.slice(0, 3).map(str).filter(Boolean) : []);

const fields = (o) => ({
  translation: str(o.translation),
  lemma: str(o.lemma),
  forms: str(o.forms),
  note: str(o.note),
  synonyms: list(o.synonyms),
  other: list(o.other),
});

// Pulls the schema's fields out of almost-JSON, one key at a time.
function looseFields(text) {
  const quoted = '"((?:[^"\\\\]|\\\\.)*)"';
  const unquote = (s) => { try { return JSON.parse(`"${s}"`); } catch { return s; } };
  const string = (key) => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*${quoted}`));
    return m ? unquote(m[1]) : '';
  };
  const array = (key) => {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)`));
    return m ? [...m[1].matchAll(new RegExp(quoted, 'g'))].map((x) => unquote(x[1])) : [];
  };
  return {
    translation: string('translation'),
    lemma: string('lemma'),
    forms: string('forms'),
    note: string('note'),
    synonyms: array('synonyms'),
    other: array('other'),
  };
}

// Models don't always return clean JSON: strip reasoning blocks and surrounding prose.
function parseResult(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const json = cleaned.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const obj = JSON.parse(json[0]);
      if (obj.translation) return fields(obj);
    } catch {
      // fall through to the loose read
    }
  }
  // Qwen3-27B does emit stray brackets ("other": [...]]) and answers can be cut off;
  // read the fields out of the text rather than dumping the raw blob in the popup.
  const loose = looseFields(json ? json[0] : cleaned);
  if (loose.translation) return fields(loose);

  return { translation: cleaned, synonyms: [], other: [] };
}
