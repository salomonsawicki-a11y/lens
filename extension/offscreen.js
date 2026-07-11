// Offscreen host for Chrome's built-in AI (Prompt API).
// The background service worker proxies calls here when its own context
// doesn't expose `LanguageModel`. Message protocol (all messages carry
// target: 'lens-offscreen'):
//   { action: 'availability' }        -> { result: 'available' | 'downloadable' | 'downloading' | 'unavailable' }
//   { action: 'prompt', prompt }      -> { result: '<model output>' }
//   { action: 'download' }            -> { result: true }  (kicks off model download)
//   { action: 'status' }              -> { result: { state, pct } }

function getLM() {
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  if (window.ai && window.ai.languageModel) return window.ai.languageModel;
  return null;
}

function normalizeAvailability(v) {
  const map = { readily: 'available', 'after-download': 'downloadable', no: 'unavailable' };
  return map[v] || v || 'unavailable';
}

function downloadPct(e) {
  if (e && e.total) return Math.round((e.loaded / e.total) * 100);
  if (e && typeof e.loaded === 'number' && e.loaded <= 1) return Math.round(e.loaded * 100);
  return 0;
}

const download = { state: 'idle', pct: 0 };
let sessionPromise = null;

async function availability() {
  const lm = getLM();
  if (!lm) return 'unavailable';
  try {
    if (typeof lm.availability === 'function') return normalizeAvailability(await lm.availability());
    if (typeof lm.capabilities === 'function') {
      const c = await lm.capabilities();
      return normalizeAvailability(c.available);
    }
  } catch (e) { /* fall through */ }
  return 'unavailable';
}

function getSession() {
  if (sessionPromise) return sessionPromise;
  const lm = getLM();
  if (!lm) return Promise.reject(new Error('Built-in AI is not supported in this Chrome.'));
  download.state = 'creating';
  const base = {
    monitor(m) {
      try {
        m.addEventListener('downloadprogress', (e) => {
          download.state = 'downloading';
          download.pct = downloadPct(e);
        });
      } catch (err) { /* monitor optional */ }
    },
  };
  sessionPromise = lm.create({
    ...base,
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  }).catch(() => lm.create(base)) // older builds reject the language hints
    .then((s) => { download.state = 'ready'; return s; })
    .catch((e) => { download.state = 'idle'; sessionPromise = null; throw e; });
  return sessionPromise;
}

async function runPrompt(prompt) {
  const base = await getSession();
  // Prompt on a clone so each request starts from a clean context; repeated
  // prompts on one session accumulate history and overflow the small
  // on-device context window.
  let s = base;
  if (typeof base.clone === 'function') {
    try { s = await base.clone(); } catch (e) { s = base; }
  }
  try {
    const out = await s.prompt(prompt);
    if (typeof out !== 'string' || !out.trim()) throw new Error('Empty response from built-in AI.');
    return out;
  } catch (e) {
    sessionPromise = null; // dead sessions can't be reused
    throw new Error('Built-in AI error: ' + (e && e.message ? e.message : String(e)));
  } finally {
    if (s !== base && typeof s.destroy === 'function') { try { s.destroy(); } catch (e) {} }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'lens-offscreen') return; // not for us
  (async () => {
    try {
      if (msg.action === 'availability') {
        sendResponse({ result: await availability() });
      } else if (msg.action === 'prompt') {
        sendResponse({ result: await runPrompt(msg.prompt) });
      } else if (msg.action === 'download') {
        getSession().catch(() => {}); // fire and forget; progress via 'status'
        sendResponse({ result: true });
      } else if (msg.action === 'status') {
        sendResponse({ result: { state: download.state, pct: download.pct } });
      } else {
        sendResponse({ error: 'Unknown offscreen action: ' + msg.action });
      }
    } catch (e) {
      sendResponse({ error: e && e.message ? e.message : String(e) });
    }
  })();
  return true; // async response
});
