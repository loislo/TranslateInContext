const SERVER_FIELDS = ['primaryBaseUrl', 'primaryModel', 'primaryKey', 'fallbackBaseUrl', 'fallbackModel', 'fallbackKey'];
// Server fields are saved exactly as typed, empty included — clearing one is how you switch a slot off.
const TEXT_FIELDS = ['targetLang', ...SERVER_FIELDS, 'wordPrompt', 'passagePrompt'];

const $ = (id) => document.getElementById(id);

function setStatus(text) {
  $('status').textContent = text;
}

getSettings().then((s) => {
  for (const f of TEXT_FIELDS) $(f).value = s[f];
  $('timeoutSec').value = s.timeoutSec;
  $('temperature').value = s.temperature;
});

document.querySelectorAll('.reset').forEach((b) => b.addEventListener('click', () => {
  $(b.dataset.field).value = DEFAULT_SETTINGS[b.dataset.field];
  setStatus('Reset — press Save to keep it.');
}));

$('save').addEventListener('click', async () => {
  const values = {
    timeoutSec: Number($('timeoutSec').value) || DEFAULT_SETTINGS.timeoutSec,
    temperature: $('temperature').value.trim(), // empty stays empty: the field is then not sent
  };
  for (const f of TEXT_FIELDS) {
    const v = $(f).value.trim();
    values[f] = (v || SERVER_FIELDS.includes(f)) ? v : DEFAULT_SETTINGS[f];
  }

  const origins = [];
  for (const [baseUrl, model] of [[values.primaryBaseUrl, values.primaryModel], [values.fallbackBaseUrl, values.fallbackModel]]) {
    if (!baseUrl || !model) continue;
    try {
      const url = new URL(baseUrl);
      origins.push(`${url.protocol}//${url.hostname}/*`);
    } catch {
      setStatus(`Not a valid Base URL: ${baseUrl}`);
      return;
    }
  }

  let warning = '';
  if (origins.length) {
    // Reaching a host needs permission; it must be requested directly in the click gesture.
    try {
      const granted = await chrome.permissions.request({ origins });
      if (!granted) warning = ' Permission for those hosts was denied; requests to them will fail.';
    } catch (e) {
      warning = ` Could not request permission: ${e.message}`;
    }
  }

  await chrome.storage.local.set(values);
  for (const f of TEXT_FIELDS) $(f).value = values[f];
  $('timeoutSec').value = values.timeoutSec;
  $('temperature').value = values.temperature;
  setStatus('Saved.' + warning);
});
