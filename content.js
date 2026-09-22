const POPUP_CSS = `
  :host { all: initial; }
  .box {
    box-sizing: border-box; min-width: 160px; max-width: 320px; padding: 10px 12px;
    border-radius: 8px; border: 1px solid #d0d0d0; background: #fff; color: #1a1a1a;
    box-shadow: 0 4px 16px rgba(0, 0, 0, .18);
    font: 14px/1.4 system-ui, -apple-system, sans-serif; overflow-wrap: break-word;
  }
  .word { font-size: 12px; color: #666; }
  .translation { font-size: 16px; font-weight: 600; margin-top: 2px; }
  .forms { font-size: 13px; color: #444; margin-top: 2px; }
  .muted { color: #555; margin-top: 4px; }
  .other { font-size: 13px; color: #555; margin-top: 4px; }
  .error { color: #b00020; margin-top: 4px; }
  .via { font-size: 11px; color: #888; margin-top: 6px; }
  @media (prefers-color-scheme: dark) {
    .box { background: #242424; color: #eee; border-color: #444; }
    .word { color: #aaa; }
    .muted { color: #bbb; }
    .forms, .other { color: #ccc; }
    .via { color: #888; }
    .error { color: #ff8a80; }
  }
`;

let host = null; // popup host element; content lives in a shadow root so page CSS can't touch it
let shadow = null;
let requestId = 0; // lets stale responses be ignored

// A double-click's second mouseup already carries the selected word, so this one handler
// covers both double-clicking a word and dragging a selection across a phrase.
document.addEventListener('mouseup', (e) => {
  if (host && e.composedPath().includes(host)) return;
  if (e.target.closest?.('input, textarea') || e.target.isContentEditable) return;

  const sel = window.getSelection();
  const word = sel.toString().trim();
  if (!word || word.length > 600 || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const { phrase, sentence } = extractContext(range);
  if (!phrase) return; // e.g. a selection of punctuation only
  const rect = range.getBoundingClientRect();
  const anchor = { left: rect.left + scrollX, top: rect.top + scrollY, bottom: rect.bottom + scrollY };

  const id = ++requestId;
  showPopup(anchor, { word: phrase, loading: true });
  try {
    chrome.runtime.sendMessage({ type: 'translate', word: phrase, sentence }, (res) => {
      if (id !== requestId) return;
      if (chrome.runtime.lastError) res = { ok: false, error: chrome.runtime.lastError.message };
      showPopup(anchor, { word: phrase, ...res });
    });
  } catch {
    showPopup(anchor, { word: phrase, ok: false, error: 'The extension was reloaded. Refresh this page.' });
  }
});

document.addEventListener('mousedown', (e) => {
  if (host && !e.composedPath().includes(host)) hidePopup();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hidePopup();
});

const WORD_CHAR = /[\p{L}\p{N}'’\-]/u;

// Returns the selected text grown to whole words (a drag usually starts or ends mid-word)
// and the sentence around it, both read from the nearest block-level ancestor.
function extractContext(range) {
  let block = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  while (block !== document.body && block.parentElement && /^(inline|contents)/.test(getComputedStyle(block).display)) {
    block = block.parentElement;
  }

  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);

  // Collapse whitespace first: source line breaks would otherwise be treated as sentence breaks.
  const collapse = (s) => s.replace(/\s+/g, ' ');
  const text = collapse(block.textContent);
  const offset = collapse(before.toString()).length;

  let start = offset;
  let end = Math.min(text.length, start + collapse(range.toString()).length);
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;

  return { phrase: text.slice(start, end).trim(), sentence: sentenceAround(text, start) };
}

// A break after "z. B.", "Dr." or inside a citation marker is not a real sentence end.
const ABBREVIATION = /(?:^|[\s(])(?:\p{L}|Dr|Prof|Mr|Mrs|Ms|St|Nr|Abb|Jh|Bd|Hrsg|Aufl|ca|bzw|usw|etc|vgl|ggf|inkl|evtl|sog|engl|dt|lat|vs|No|Fig|al)\.["'”’»)\]]?\s*$/u;
const OPEN_CITATION = /\[\s*$/;
const CONTINUATION = /^\s*[\p{Ll}\])]/u; // a "sentence" starting lowercase continues the previous one

const spurious = (before, after) =>
  ABBREVIATION.test(before) || OPEN_CITATION.test(before) || CONTINUATION.test(after);

function sentenceAround(text, index) {
  // Segmenting a whole huge block would be wasteful; a window around the word is plenty.
  const from = Math.max(0, index - 1500);
  const window = text.slice(from, index + 1500);
  const at = index - from;

  const segments = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(window)];
  let first = segments.findIndex((s) => at < s.index + s.segment.length);
  if (first < 0) first = segments.length - 1;
  let last = first;
  while (first > 0 && spurious(segments[first - 1].segment, segments[first].segment)) first--;
  while (last < segments.length - 1 && spurious(segments[last].segment, segments[last + 1].segment)) last++;

  const sentence = segments.slice(first, last + 1).map((s) => s.segment).join('');
  return (sentence.length <= 1000 ? sentence : window.slice(Math.max(0, at - 300), at + 300)).trim();
}

function showPopup(anchor, state) {
  if (!host) {
    host = document.createElement('div');
    host.style.cssText = 'position: absolute; z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(host);
  }

  const style = document.createElement('style');
  style.textContent = POPUP_CSS;
  const box = el('div', 'box');
  box.append(el('div', 'word', state.word.length > 70 ? `${state.word.slice(0, 70)}…` : state.word));
  if (state.loading) {
    box.append(el('div', 'muted', 'Translating…'));
  } else if (!state.ok) {
    box.append(el('div', 'error', state.error));
  } else {
    box.append(el('div', 'translation', state.translation));
    const forms = [state.lemma, state.forms].filter(Boolean).join(' · ');
    if (forms) box.append(el('div', 'forms', forms));
    if (state.synonyms?.length) box.append(el('div', 'forms', `≈ ${state.synonyms.join(', ')}`));
    if (state.note) box.append(el('div', 'muted', state.note));
    if (state.other?.length) box.append(el('div', 'other', `also: ${state.other.join(', ')}`));
    if (state.via) box.append(el('div', 'via', `via ${state.via}`)); // only set when the fallback was used
  }
  shadow.replaceChildren(style, box);

  // Place below the word, flipping above if it would overflow the viewport bottom.
  host.style.left = '0px';
  host.style.top = '0px';
  const { width, height } = host.getBoundingClientRect();
  const maxLeft = scrollX + document.documentElement.clientWidth - width - 8;
  let top = anchor.bottom + 6;
  if (top + height > scrollY + innerHeight && anchor.top - height - 6 > scrollY) {
    top = anchor.top - height - 6;
  }
  host.style.left = `${Math.max(scrollX + 8, Math.min(anchor.left, maxLeft))}px`;
  host.style.top = `${top}px`;
}

function hidePopup() {
  requestId++;
  host?.remove();
  host = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
