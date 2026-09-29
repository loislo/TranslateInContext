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

  const servers = configuredServers(s);
  if (!servers.length) throw new Error('Set a model in the extension options.');

  let firstError;
  for (const [i, server] of servers.entries()) {
    try {
      const result = parseResult(await chat(server, system, user, s));
      return i === 0 ? result : { ...result, via: server.name };
    } catch (err) {
      // A 4xx is a configuration mistake (wrong model name, bad key) — show it instead of hiding
      // this server behind a fallback that would then be used forever.
      if (err.status && err.status < 500) throw err;
      console.warn(`${server.name} failed:`, err.message);
      firstError ??= err;
    }
  }
  throw firstError;
}

function configuredServers(s) {
  const servers = [];
  if (s.localBaseUrl && s.localModel) {
    servers.push({ name: 'your server', baseUrl: s.localBaseUrl, model: s.localModel, key: s.localKey, timeoutMs: s.timeoutSec * 1000 });
  }
  if (s.geminiKey) {
    servers.push({ name: 'Gemini', baseUrl: GEMINI_BASE_URL, model: s.geminiModel, key: s.geminiKey });
  }
  return servers;
}

// Thinking costs ~44s per lookup on Qwen3/vLLM and ~6s on Gemini, for the same answer — but each
// server names the switch differently and rejects the others, so try them in order once per server.
const NO_THINKING = [
  { chat_template_kwargs: { enable_thinking: false } }, // vLLM, Ollama, LM Studio
  { reasoning_effort: 'none' },                         // Google's OpenAI layer, OpenAI
  {},                                                   // servers that reject both
];
const accepted = new Map(); // base URL -> the variant it accepted, until the worker restarts

async function chat(server, system, user, s) {
  const url = server.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = server.key ? { Authorization: `Bearer ${server.key}` } : {};
  const body = {
    model: server.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(temperature(s) === null ? {} : { temperature: temperature(s) }),
  };

  let data;
  for (let i = accepted.get(server.baseUrl) ?? 0; ; i++) {
    try {
      data = await postJson(url, headers, { ...body, ...NO_THINKING[i] }, server.timeoutMs);
      accepted.set(server.baseUrl, i);
      break;
    } catch (err) {
      if (err.status !== 400 || i === NO_THINKING.length - 1) throw err;
    }
  }

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

// Left empty the field is simply not sent: some models reject any value but their default.
function temperature(s) {
  const t = Number(s.temperature);
  return s.temperature === '' || s.temperature == null || Number.isNaN(t) ? null : t;
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
