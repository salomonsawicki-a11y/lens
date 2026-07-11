// Lens background service worker.
// Routes explanation requests to an AI engine — the Lens cloud service by
// default (works on any hardware, no key), Chrome's built-in on-device model
// as a private/offline fallback, and the user's optional Anthropic API key as
// a quality upgrade — relays the ⌘E command to the active tab's content
// script, and exposes message endpoints for explain / define / related /
// followup.

// The Lens explanation service (see server/README.md for the 3-minute
// deploy). Users can override it in Settings → Service URL.
const LENS_SERVER = 'https://lens-api.REPLACE-ME.workers.dev';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const RETIRED_MODELS = new Set(['claude-3-5-haiku-latest','claude-3-5-haiku-20241022','claude-3-5-sonnet-latest','claude-3-5-sonnet-20241022','claude-3-5-sonnet-20240620','claude-3-7-sonnet-latest','claude-3-7-sonnet-20250219','claude-3-haiku-20240307','claude-3-opus-latest','claude-3-opus-20240229','claude-3-sonnet-20240229']);
function cleanProse(s){if(typeof s!=='string')return s;s=s.replace(/^[ \t]*#{1,6}[ \t]+[^\n]*\r?\n+/gm,'');s=s.replace(/^\s*\*\*[^*\n]+\*\*\s*\r?\n+/,'');return s.trimStart();}

function getSettings() {
  return new Promise((res) => {
    chrome.storage.local.get(['apiKey', 'model', 'engine', 'serverUrl'], (s) => {
      let model = s.model || DEFAULT_MODEL;
      if (RETIRED_MODELS.has(model)) { model = DEFAULT_MODEL; chrome.storage.local.set({ model }); }
      const engine = s.engine || 'auto';
      const serverUrl = ((s.serverUrl || '').trim() || LENS_SERVER).replace(/\/+$/, '');
      res({ apiKey: (s.apiKey || '').trim(), model, engine, serverUrl });
    });
  });
}

// ── Lens cloud service ──────────────────────────────────────────────────────
// A Cloudflare Worker (server/worker.js) that answers with a hosted model —
// works on any device, no user setup. Free Workers AI by default; Claude if
// the operator set an Anthropic key server-side.

function serverConfigured(url) {
  return !!url && !url.includes('REPLACE-ME');
}

// Random per-install ID sent with service requests so the operator can
// rate-limit abusive clients. Not tied to any account or page data.
function getUid() {
  return new Promise((res) => {
    chrome.storage.local.get(['uid'], (s) => {
      if (s.uid) return res(s.uid);
      const uid = crypto.randomUUID();
      chrome.storage.local.set({ uid });
      res(uid);
    });
  });
}

async function callLensServer(prompt) {
  const { serverUrl } = await getSettings();
  if (!serverConfigured(serverUrl)) throw new Error('__server_unconfigured__');
  let r;
  try {
    r = await fetch(serverUrl + '/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, uid: await getUid() }),
    });
  } catch (e) {
    throw new Error('__server_unreachable__');
  }
  if (!r.ok) {
    let detail = '';
    try { const j = await r.json(); detail = j.error || JSON.stringify(j); }
    catch (e) { detail = await r.text().catch(() => ''); }
    throw new Error(`Lens service error (${r.status}): ${String(detail).slice(0, 200)}`);
  }
  const j = await r.json().catch(() => null);
  if (!j || typeof j.text !== 'string' || !j.text.trim()) {
    throw new Error('Lens service returned an empty response.');
  }
  return j.text;
}

async function serviceStatus() {
  const { serverUrl } = await getSettings();
  if (!serverConfigured(serverUrl)) return { state: 'unconfigured' };
  try {
    const r = await fetch(serverUrl + '/health');
    if (!r.ok) return { state: 'error' };
    const j = await r.json().catch(() => ({}));
    return { state: 'ok', engine: j.engine || 'unknown' };
  } catch (e) {
    return { state: 'unreachable' };
  }
}

// ── Built-in AI (Chrome's on-device model, via the Prompt API) ─────────────
// Free, private, zero setup: the model runs on the user's own machine.
//
// The Prompt API is not exposed in every context. Newer Chrome exposes the
// `LanguageModel` global directly in the extension service worker; older
// builds only expose it in document contexts. So we use it directly when we
// can, and otherwise proxy every call to an offscreen document
// (offscreen.html) that hosts the API for us.

function getLM() {
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) return self.ai.languageModel;
  return null;
}

function normalizeAvailability(v) {
  // Newer API: 'available' | 'downloadable' | 'downloading' | 'unavailable'
  // Older capabilities(): { available: 'readily' | 'after-download' | 'no' }
  const map = { readily: 'available', 'after-download': 'downloadable', no: 'unavailable' };
  return map[v] || v || 'unavailable';
}

function downloadPct(e) {
  // Newer Chrome reports e.loaded as a 0..1 fraction (no e.total); older
  // builds report loaded/total byte counts. Normalize to 0-100.
  if (e && e.total) return Math.round((e.loaded / e.total) * 100);
  if (e && typeof e.loaded === 'number' && e.loaded <= 1) return Math.round(e.loaded * 100);
  return 0;
}

const builtinDownload = { state: 'idle', pct: 0 };
let builtinSession = null;

async function directAvailability() {
  const lm = getLM();
  if (!lm) return null; // not exposed in this context
  try {
    if (typeof lm.availability === 'function') return normalizeAvailability(await lm.availability());
    if (typeof lm.capabilities === 'function') {
      const c = await lm.capabilities();
      return normalizeAvailability(c.available);
    }
  } catch (e) { /* fall through */ }
  return 'unavailable';
}

async function getBuiltinSession() {
  if (builtinSession) return builtinSession;
  const lm = getLM();
  if (!lm) throw new Error('Built-in AI is not exposed in this context.');
  builtinDownload.state = 'creating';
  const base = {
    monitor(m) {
      try {
        m.addEventListener('downloadprogress', (e) => {
          builtinDownload.state = 'downloading';
          builtinDownload.pct = downloadPct(e);
        });
      } catch (err) { /* monitor optional */ }
    },
  };
  try {
    builtinSession = await lm.create({
      ...base,
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
  } catch (e) {
    // Older builds reject the language hints — retry with the bare options.
    builtinSession = await lm.create(base).catch((e2) => {
      builtinDownload.state = 'idle';
      throw e2;
    });
  }
  builtinDownload.state = 'ready';
  return builtinSession;
}

async function directPrompt(prompt) {
  const base = await getBuiltinSession();
  // Prompt on a clone when possible so each request starts from a clean
  // context (repeated prompts on one session accumulate history and
  // eventually overflow the on-device model's small context window).
  let s = base;
  if (typeof base.clone === 'function') {
    try { s = await base.clone(); } catch (e) { s = base; }
  }
  try {
    const out = await s.prompt(prompt);
    if (typeof out !== 'string' || !out.trim()) throw new Error('Empty response from built-in AI.');
    return out;
  } catch (e) {
    // A dead session can't be reused; drop it so the next call recreates.
    builtinSession = null;
    throw new Error('Built-in AI error: ' + (e && e.message ? e.message : String(e)));
  } finally {
    if (s !== base && typeof s.destroy === 'function') { try { s.destroy(); } catch (e) {} }
  }
}

// ── Offscreen host (fallback when the worker lacks the Prompt API) ─────────
const OFFSCREEN_URL = 'offscreen.html';
let offscreenCreating = null;

async function ensureOffscreen() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    throw new Error('Offscreen documents are not supported in this Chrome.');
  }
  if (offscreenCreating) return offscreenCreating;
  offscreenCreating = (async () => {
    const has = await chrome.offscreen.hasDocument().catch(() => false);
    if (has) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WORKERS'],
      justification: "Hosts Chrome's built-in on-device AI (Prompt API), which requires a document context in this Chrome version.",
    }).catch((e) => {
      // Racing a concurrent create is fine — the document exists either way.
      if (!/single offscreen/i.test(String(e && e.message))) throw e;
    });
  })();
  try { return await offscreenCreating; }
  finally { offscreenCreating = null; }
}

async function offscreenCall(action, payload) {
  await ensureOffscreen();
  const resp = await chrome.runtime.sendMessage({ target: 'lens-offscreen', action, ...(payload || {}) });
  if (!resp) throw new Error('Built-in AI host did not respond.');
  if (resp.error) throw new Error(resp.error);
  return resp.result;
}

// ── Unified built-in engine (direct or via offscreen) ──────────────────────
async function builtinAvailability() {
  const direct = await directAvailability();
  if (direct !== null) return direct;
  try { return normalizeAvailability(await offscreenCall('availability')); }
  catch (e) { return 'unavailable'; }
}

async function callBuiltin(prompt) {
  if (getLM()) return directPrompt(prompt);
  return offscreenCall('prompt', { prompt });
}

function builtinStartDownload() {
  if (getLM()) { getBuiltinSession().catch(() => {}); return; }
  offscreenCall('download').catch(() => {});
}

async function builtinDownloadStatus() {
  if (getLM()) return builtinDownload;
  try { return await offscreenCall('status'); }
  catch (e) { return { state: 'idle', pct: 0 }; }
}

// Kick off the one-time model download as soon as the extension is installed
// so that by the time the user highlights something, it's ready. Best effort:
// unsupported devices just no-op.
async function builtinWarmup() {
  try {
    const avail = await builtinAvailability();
    if (avail === 'downloadable' || avail === 'downloading') builtinStartDownload();
  } catch (e) { /* best effort */ }
}

// ── Engine router ───────────────────────────────────────────────────────────
// Default ('auto'): the Lens cloud service — works on any hardware, zero
// setup. Saving an Anthropic API key is an explicit upgrade: auto then calls
// Claude directly instead. Built-in on-device AI is the fallback when the
// service can't answer (and a first-class engine users can pick themselves).
async function callModel(prompt) {
  const { apiKey, engine } = await getSettings();
  if (engine === 'cloud') return callClaude(prompt);
  if (engine === 'builtin') return callBuiltinOnly(prompt);
  if (engine === 'lens') return callLensOnly(prompt);

  // 'auto'
  if (apiKey) return callClaude(prompt);
  let serviceErr = null;
  try { return await callLensServer(prompt); }
  catch (e) { serviceErr = e; }

  // Service didn't answer — fall back to on-device AI if this machine has it.
  const avail = await builtinAvailability();
  if (avail === 'available') return callBuiltin(prompt);
  if (avail === 'downloadable' || avail === 'downloading') builtinStartDownload();

  const m = serviceErr.message || '';
  const reason = m === '__server_unconfigured__'
    ? 'This Lens build has no explanation service configured'
    : m === '__server_unreachable__'
      ? "Couldn't reach the Lens explanation service (are you offline?)"
      : m;
  throw new Error(reason + ". Built-in on-device AI isn't ready on this machine either. You can add an Anthropic API key in Lens Settings (toolbar icon → Settings) to explain with Claude directly.");
}

async function callLensOnly(prompt) {
  try { return await callLensServer(prompt); }
  catch (e) {
    const m = e.message || '';
    if (m === '__server_unconfigured__') throw new Error('This Lens build has no explanation service configured. Set the Service URL in Lens Settings (see server/README.md for deploying one).');
    if (m === '__server_unreachable__') throw new Error("Couldn't reach the Lens explanation service. Check your connection, or check the Service URL in Lens Settings.");
    throw e;
  }
}

async function callBuiltinOnly(prompt) {
  const avail = await builtinAvailability();
  if (avail === 'available') return callBuiltin(prompt);
  if (avail === 'downloadable' || avail === 'downloading') {
    builtinStartDownload();
    throw new Error(await downloadingMessage());
  }
  throw new Error("Built-in AI isn't supported on this device or Chrome version. Update Chrome, or switch the engine to Claude API in Lens Settings.");
}

async function downloadingMessage() {
  const st = await builtinDownloadStatus();
  const pct = st && st.state === 'downloading' && st.pct ? ` (${st.pct}% done)` : '';
  return `Chrome is downloading its built-in AI model${pct} — a one-time setup that runs in the background. Try again in a few minutes. You can watch progress in Lens Settings, or add an Anthropic API key there to start right away.`;
}

async function callClaude(prompt) {
  const { apiKey, model } = await getSettings();
  if (!apiKey) {
    throw new Error('No API key set. Open the Lens extension options page (right-click toolbar icon → Options) and paste your Anthropic API key.');
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Required for direct browser/extension calls.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    let detail = '';
    try { const j = await r.json(); detail = j?.error?.message || JSON.stringify(j); }
    catch (e) { detail = await r.text().catch(() => ''); }
    throw new Error(`Anthropic API ${r.status}: ${detail.slice(0, 240)}`);
  }
  const j = await r.json();
  const text = (j.content || []).map((b) => b.text || '').join('').trim();
  return text;
}

// ── Prompt builders (mirrored from the artifact) ────────────────────────────
function ctxBlock(context, title) {
  if (!context && !title) return '\n\n';
  const where = title ? `"${title}"` : 'a document';
  return `\n\nThe reader is viewing ${where}. Surrounding context:\n\n${context || '(no surrounding context available)'}\n\n`;
}
function explainPrompt(text, mode, context, title) {
  const ctx = ctxBlock(context, title);
  if (mode === 'simple') {
    return `You are an AI extension that helps a reader understand text they highlighted. The user highlighted this passage:\n\n"${text}"${ctx}Explain it in plain English in 2-3 short paragraphs, grounded in what THIS document is actually discussing. Define any jargon inline. Be conversational but precise. No markdown headings or bullet lists.`;
  }
  return `You are an AI extension helping a reader understand text they highlighted. The user highlighted this passage:\n\n"${text}"${ctx}Explain it at a technical, expert level in 2-3 short paragraphs, grounded in this document's subject matter. No markdown headings or bullet lists.`;
}

function definePrompt(text, context, title) {
  const ctx = ctxBlock(context, title);
  return `Passage:\n\n"${text}"${ctx}Extract 3-5 technical terms a reader might not know, with a 1-sentence plain-English definition each, using THIS document's specific sense. Return ONLY a JSON array like [{"term":"...","def":"..."}, ...] with no surrounding text, no markdown fences.`;
}

function relatedPrompt(text, context, title) {
  const ctx = ctxBlock(context, title);
  return `Passage:\n\n"${text}"${ctx}List 3-5 related concepts a reader of THIS document should look up next. Return ONLY a JSON array of short strings like ["...", "...", ...] with no surrounding text, no markdown fences.`;
}

function followupPrompt(text, conversation, question, context, title) {
  const history = (conversation || []).map((m) => `${(m.role || '').toUpperCase()}: ${m.content || ''}`).join('\n\n');
  const ctx = ctxBlock(context, title);
  return `User highlighted:\n\n"${text}"${ctx}Prior conversation:\n${history}\n\nNew question:\n${question}\n\nAnswer concisely (1-2 paragraphs), conversational, no markdown. Ground in the document's specifics.`;
}

function safeParseJsonArray(raw, fallback) {
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    return JSON.parse(m ? m[0] : raw);
  } catch (e) { return fallback; }
}

// ── Message router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'lens-offscreen') return; // offscreen host handles its own
  (async () => {
    try {
      if (msg.action === 'explain') {
        const text = await callModel(explainPrompt(msg.text, msg.mode, msg.context, msg.title));
        sendResponse({ result: cleanProse(text) });
      } else if (msg.action === 'define') {
        const raw = await callModel(definePrompt(msg.text, msg.context, msg.title));
        sendResponse({ result: safeParseJsonArray(raw, [{ term: 'Definition', def: raw.slice(0, 200) }]) });
      } else if (msg.action === 'related') {
        const raw = await callModel(relatedPrompt(msg.text, msg.context, msg.title));
        sendResponse({ result: safeParseJsonArray(raw, [raw.slice(0, 120)]) });
      } else if (msg.action === 'followup') {
        const text = await callModel(followupPrompt(msg.text, msg.conversation, msg.question, msg.context, msg.title));
        sendResponse({ result: cleanProse(text) });
      } else if (msg.action === 'open-from-history') {
        // Forward to the active tab's content script.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id != null) {
          chrome.tabs.sendMessage(tab.id, { type: 'lens-open-from-history', text: msg.text }, () => { void chrome.runtime.lastError; });
        }
        sendResponse({ result: true });
      } else if (msg.action === 'test-key') {
        // Lightweight ping for the options page validator.
        await callClaude('Reply with exactly: OK');
        sendResponse({ result: true });
      } else if (msg.action === 'engine-status') {
        const { apiKey, engine } = await getSettings();
        const [avail, download, service] = await Promise.all([
          builtinAvailability(),
          builtinDownloadStatus(),
          serviceStatus(),
        ]);
        sendResponse({ result: { engine, builtin: avail, download, service, hasKey: !!apiKey } });
      } else if (msg.action === 'builtin-download') {
        builtinStartDownload();
        sendResponse({ result: true });
      } else {
        sendResponse({ error: 'Unknown action: ' + msg.action });
      }
    } catch (e) {
      sendResponse({ error: e.message || String(e) });
    }
  })();
  return true; // keep the channel open for async response
});

// ── Keyboard command (⌘E) ──────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'explain-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  // Read the current selection out of every frame (the PDF embed lives in a
  // child frame; without allFrames we'd never see selections inside it).
  let text = '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => (window.getSelection && window.getSelection().toString().trim()) || '',
    });
    for (const r of results) {
      if (r && r.result && r.result.length > (text || '').length) text = r.result;
    }
  } catch (e) {}
  chrome.tabs.sendMessage(tab.id, { type: 'lens-explain-shortcut', text }, () => { void chrome.runtime.lastError; });
});

// Context menu — works on Chrome's built-in PDF viewer where the in-page
// mouseup listener cannot see selections inside the PDF embed.
function ensureContextMenu() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'lens-explain',
        title: 'Explain with Lens',
        contexts: ['selection'],
      });
    });
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
  ensureContextMenu();
  builtinWarmup(); // start the one-time on-device model download early
});
chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
  builtinWarmup();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'lens-explain' || !tab || tab.id == null) return;
  const text = (info.selectionText || '').trim();
  if (!text) return;
  chrome.tabs.sendMessage(tab.id, { type: 'lens-open-from-history', text }, () => {
    // No receiver? Inject the content script + CSS then retry.
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
        .then(() => chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] }))
        .then(() => setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { type: 'lens-open-from-history', text });
        }, 200))
        .catch(() => {});
    }
  });
});


const LENS_VIEWER = chrome.runtime.getURL('pdfjs/viewer.html');
function toViewer(t,u){ chrome.tabs.update(t,{url:LENS_VIEWER+'?file='+encodeURIComponent(u)}); }
function urlIsPdf(u){try{const x=new URL(u);
 if(!['http:','https:','file:'].includes(x.protocol))return false;
 if(u.startsWith(LENS_VIEWER))return false;
 if(/\.pdf($|[?#])/i.test(x.pathname+x.search))return true;
 if(/(^|\.)arxiv\.org$/i.test(x.hostname)&&/^\/pdf\//i.test(x.pathname))return true;
 return false;}catch(e){return false;}}
chrome.webNavigation.onBeforeNavigate.addListener((d)=>{
 if(d.frameId!==0)return; if(urlIsPdf(d.url))toViewer(d.tabId,d.url);});
chrome.webRequest.onHeadersReceived.addListener((d)=>{
 if(d.type!=='main_frame')return; if(!d.url||d.url.startsWith(LENS_VIEWER))return;
 const h=(d.responseHeaders||[]).find((x)=>x.name&&x.name.toLowerCase()==='content-type');
 if(h&&/application\/pdf/i.test(h.value||''))toViewer(d.tabId,d.url);
},{urls:['<all_urls>'],types:['main_frame']},['responseHeaders']);
