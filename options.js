const TEXT_FIELDS = ['targetLang', 'openaiBaseUrl', 'openaiModel', 'openaiKey', 'geminiKey', 'geminiModel'];
const OPTIONAL_FIELDS = ['openaiModel', 'openaiKey', 'geminiKey']; // may be saved empty; others fall back to defaults

const $ = (id) => document.getElementById(id);

function setStatus(text) {
  $('status').textContent = text;
}

getSettings().then((s) => {
  for (const f of TEXT_FIELDS) $(f).value = s[f];
  $('primaryTimeoutSec').value = s.primaryTimeoutSec;
  $('fallbackToGemini').checked = s.fallbackToGemini;
});

$('save').addEventListener('click', async () => {
  const values = {
    fallbackToGemini: $('fallbackToGemini').checked,
    primaryTimeoutSec: Number($('primaryTimeoutSec').value) || DEFAULT_SETTINGS.primaryTimeoutSec,
  };
  for (const f of TEXT_FIELDS) {
    const v = $(f).value.trim();
    values[f] = (v || OPTIONAL_FIELDS.includes(f)) ? v : DEFAULT_SETTINGS[f];
  }

  let warning = '';
  if (values.openaiModel) {
    let url;
    try {
      url = new URL(values.openaiBaseUrl);
    } catch {
      setStatus('Base URL is not valid.');
      return;
    }
    // Reaching a custom host needs permission; it must be requested directly in the click gesture.
    try {
      const granted = await chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
      if (!granted) warning = ' Permission for that host was denied; requests to it will fail.';
    } catch (e) {
      warning = ` Could not request permission for that host: ${e.message}`;
    }
  }

  await chrome.storage.local.set(values);
  for (const f of TEXT_FIELDS) $(f).value = values[f];
  $('primaryTimeoutSec').value = values.primaryTimeoutSec;
  setStatus('Saved.' + warning);
});
