// Options page logic. Reads/writes settings via chrome.storage.local and pings
// the background worker to test the API key.

const els = {
  apiKey: document.getElementById('apiKey'),
  engine: document.getElementById('engine'),
  serverUrl: document.getElementById('serverUrl'),
  engineStatus: document.getElementById('engineStatus'),
  downloadBtn: document.getElementById('downloadBtn'),
  showBtn: document.getElementById('showBtn'),
  model: document.getElementById('model'),
  saveBtn: document.getElementById('saveBtn'),
  testBtn: document.getElementById('testBtn'),
  status: document.getElementById('status'),
  tint: document.getElementById('tint'),
  dark: document.getElementById('dark'),
  popupWidth: document.getElementById('popupWidth'),
  popupWidthVal: document.getElementById('popupWidthVal'),
  fontSize: document.getElementById('fontSize'),
  fontSizeVal: document.getElementById('fontSizeVal'),
  streamSpeed: document.getElementById('streamSpeed'),
  streamSpeedVal: document.getElementById('streamSpeedVal'),
  historyCount: document.getElementById('historyCount'),
  savedCount: document.getElementById('savedCount'),
  clearHistory: document.getElementById('clearHistory'),
  clearSaved: document.getElementById('clearSaved'),
};

const DEFAULTS = {
  apiKey: '',
  engine: 'auto',
  model: 'claude-haiku-4-5-20251001',
  tint: 'violet',
  dark: false,
  popupWidth: 360,
  fontSize: 13,
  streamSpeed: 3,
};

function load() {
  chrome.storage.local.get(
    ['apiKey', 'engine', 'model', 'serverUrl', 'tint', 'dark', 'popupWidth', 'fontSize', 'streamSpeed', 'history', 'saved'],
    (s) => {
      els.apiKey.value = s.apiKey || '';
      els.serverUrl.value = s.serverUrl || '';
      els.engine.value = s.engine || DEFAULTS.engine;
      els.model.value = s.model || DEFAULTS.model;
      els.tint.value = s.tint || DEFAULTS.tint;
      els.dark.dataset.on = s.dark ? '1' : '0';
      els.popupWidth.value = s.popupWidth || DEFAULTS.popupWidth;
      els.popupWidthVal.textContent = (s.popupWidth || DEFAULTS.popupWidth) + 'px';
      els.fontSize.value = s.fontSize || DEFAULTS.fontSize;
      els.fontSizeVal.textContent = (s.fontSize || DEFAULTS.fontSize) + 'px';
      els.streamSpeed.value = s.streamSpeed || DEFAULTS.streamSpeed;
      els.streamSpeedVal.textContent = s.streamSpeed || DEFAULTS.streamSpeed;
      els.historyCount.textContent = (s.history || []).length;
      els.savedCount.textContent = (s.saved || []).length;
    }
  );
}

function setStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = 'status ' + (kind || '');
  if (kind === 'ok') setTimeout(() => { els.status.textContent = ''; els.status.className = 'status'; }, 2500);
}

els.showBtn.addEventListener('click', () => {
  if (els.apiKey.type === 'password') {
    els.apiKey.type = 'text';
    els.showBtn.textContent = 'Hide';
  } else {
    els.apiKey.type = 'password';
    els.showBtn.textContent = 'Show';
  }
});

els.saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    apiKey: els.apiKey.value.trim(),
    model: els.model.value,
    engine: els.engine.value,
    serverUrl: els.serverUrl.value.trim(),
  }, () => { setStatus('Saved.', 'ok'); refreshEngineStatus(); });
});

// ── Built-in AI status ──
// The options page is a document context, so on most Chrome versions it can
// talk to the Prompt API directly (and a button click here carries the user
// gesture some builds require to start the model download). When the API
// isn't exposed here, fall back to asking the background worker, which
// proxies through its offscreen host.
const SERVICE_LABEL = {
  ok: '✓ Lens service is reachable — explanations work on this device with no setup.',
  unconfigured: 'No Lens service is configured in this build.',
  unreachable: 'Can\'t reach the Lens service right now (offline? wrong Service URL?).',
  error: 'The Lens service responded with an error.',
};
const AVAIL_LABEL = {
  available: 'Built-in AI: ready (used automatically if the service is down).',
  downloadable: 'Built-in AI: supported, needs a one-time model download.',
  downloading: 'Built-in AI: downloading the model (one-time)…',
  unavailable: 'Built-in AI: not supported on this Chrome/device.',
};

function pageLM() {
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

async function pageAvailability() {
  const lm = pageLM();
  if (!lm) return null; // not exposed in this context; ask the worker
  try {
    if (typeof lm.availability === 'function') return normalizeAvailability(await lm.availability());
    if (typeof lm.capabilities === 'function') {
      const c = await lm.capabilities();
      return normalizeAvailability(c.available);
    }
  } catch (e) { /* fall through */ }
  return 'unavailable';
}

function workerEngineStatus() {
  return new Promise((res) => {
    chrome.runtime.sendMessage({ action: 'engine-status' }, (r) => {
      if (chrome.runtime.lastError || !r || r.error || !r.result) return res(null);
      res(r.result);
    });
  });
}

let statusTimer = null;
let localPct = 0; // progress from an in-page download, if one is running
let lastService = null; // cached so in-page download progress keeps context

function showEngineStatus(service, builtin, pct) {
  const lines = [];
  if (service) {
    let s = SERVICE_LABEL[service.state] || SERVICE_LABEL.error;
    if (service.state === 'ok' && service.engine) {
      s += service.engine === 'claude' ? ' (answers by Claude)' : ' (free hosted model)';
    }
    lines.push(s);
  }
  let b = AVAIL_LABEL[builtin] || AVAIL_LABEL.unavailable;
  if (builtin === 'downloading' && pct) b += ' ' + pct + '%';
  lines.push(b);
  els.engineStatus.textContent = lines.join(' ');
  els.downloadBtn.style.display = (builtin === 'downloadable') ? '' : 'none';
  // Keep polling while a download could be in flight.
  clearTimeout(statusTimer);
  if (builtin === 'downloading' || builtin === 'downloadable') {
    statusTimer = setTimeout(refreshEngineStatus, 4000);
  }
}

async function refreshEngineStatus() {
  const st = await workerEngineStatus();
  let builtin = st ? st.builtin : null;
  let pct = st ? ((st.download && st.download.pct) || 0) : 0;
  if (st && st.service) lastService = st.service;
  // The options page's own view of the Prompt API wins when available —
  // it's the most direct signal, and tracks in-page downloads live.
  const pageAvail = await pageAvailability();
  if (pageAvail !== null && (builtin === null || builtin === 'unavailable')) builtin = pageAvail;
  if (localPct) pct = localPct;
  if (builtin === null && !lastService) return;
  showEngineStatus(lastService, builtin, pct);
}

els.engine.addEventListener('change', () => {
  chrome.storage.local.set({ engine: els.engine.value });
  refreshEngineStatus();
});

els.downloadBtn.addEventListener('click', async () => {
  els.downloadBtn.style.display = 'none';
  els.engineStatus.textContent = 'Starting model download… this is a one-time download of a few GB.';
  const lm = pageLM();
  if (lm) {
    // Download right here: live progress, and the click satisfies any
    // user-gesture requirement.
    try {
      const session = await lm.create({
        monitor(m) {
          try {
            m.addEventListener('downloadprogress', (e) => {
              localPct = downloadPct(e);
              showEngineStatus(lastService, 'downloading', localPct);
            });
          } catch (err) {}
        },
      });
      if (session && typeof session.destroy === 'function') { try { session.destroy(); } catch (e) {} }
    } catch (e) {
      els.engineStatus.textContent = 'Model download failed: ' + (e && e.message ? e.message : e);
      return;
    }
    refreshEngineStatus();
  } else {
    // Worker/offscreen path; poll for progress.
    chrome.runtime.sendMessage({ action: 'builtin-download' }, () => { void chrome.runtime.lastError; });
    setTimeout(refreshEngineStatus, 3000);
  }
});

refreshEngineStatus();

els.testBtn.addEventListener('click', () => {
  // Save current values before testing.
  chrome.storage.local.set({
    apiKey: els.apiKey.value.trim(),
    model: els.model.value,
  }, () => {
    setStatus('Testing…');
    chrome.runtime.sendMessage({ action: 'test-key' }, (r) => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message, 'err');
      } else if (r && r.error) {
        setStatus(r.error, 'err');
      } else {
        setStatus('Connected!', 'ok');
      }
    });
  });
});

// Appearance settings auto-save on change.
els.tint.addEventListener('change', () => chrome.storage.local.set({ tint: els.tint.value }));
els.dark.addEventListener('click', () => {
  const next = els.dark.dataset.on === '1' ? false : true;
  els.dark.dataset.on = next ? '1' : '0';
  chrome.storage.local.set({ dark: next });
});
els.popupWidth.addEventListener('input', () => {
  els.popupWidthVal.textContent = els.popupWidth.value + 'px';
  chrome.storage.local.set({ popupWidth: +els.popupWidth.value });
});
els.fontSize.addEventListener('input', () => {
  els.fontSizeVal.textContent = els.fontSize.value + 'px';
  chrome.storage.local.set({ fontSize: +els.fontSize.value });
});
els.streamSpeed.addEventListener('input', () => {
  els.streamSpeedVal.textContent = els.streamSpeed.value;
  chrome.storage.local.set({ streamSpeed: +els.streamSpeed.value });
});

els.clearHistory.addEventListener('click', () => {
  if (!confirm('Delete all explanation history?')) return;
  chrome.storage.local.set({ history: [] }, load);
});
els.clearSaved.addEventListener('click', () => {
  if (!confirm('Delete all saved explanations?')) return;
  chrome.storage.local.set({ saved: [] }, load);
});

load();
