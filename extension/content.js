// Lens content script — runs on every page (including PDFs viewed in-browser).
// Listens for text selection, shows a floating Explain button, and renders the
// glass popup with streaming AI explanations.
(() => {
  'use strict';
  if (window.__lensInjected) return;
  window.__lensInjected = true;

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    pending: null,            // { text, rect } — selection awaiting Explain click
    selection: null,          // { text, rect } — selection currently shown in popup
    popupEl: null,
    triggerEl: null,
    userPos: null,            // {left, top} if user has dragged the popup
    mode: 'simple',           // 'simple' | 'technical'
    tab: 'explain',
    streamTimer: null,
    streamingTarget: '',
    streamingFor: null,       // text whose response is currently streaming
    cache: new Map(),         // text|mode -> response
    inflight: new Set(),      // cache keys with a request in progress
    followUps: [],
    isSaved: false,
    dark: false,
    streamSpeed: 3,
    popupWidth: 360,
    fontSize: 13,
    tint: 'violet',
  };

  // ── Settings (from chrome.storage) ───────────────────────────────────────
  function loadSettings() {
    return new Promise((res) => {
      chrome.storage.local.get(
        ['dark', 'streamSpeed', 'popupWidth', 'fontSize', 'tint', 'enabled'],
        (s) => {
          if (s.dark != null) state.dark = !!s.dark;
          if (s.streamSpeed) state.streamSpeed = +s.streamSpeed;
          if (s.popupWidth) state.popupWidth = +s.popupWidth;
          if (s.fontSize) state.fontSize = +s.fontSize;
          if (s.tint) state.tint = s.tint;
          state.enabled = s.enabled !== false;
          res();
        }
      );
    });
  }

  const VISUAL_KEYS = new Set(['dark', 'tint', 'popupWidth', 'fontSize', 'streamSpeed']);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changedKeys = Object.keys(changes);
    for (const k of changedKeys) {
      if (k in state) state[k] = changes[k].newValue;
    }
    if (state.popupEl) {
      const onlyVisual = changedKeys.length > 0 && changedKeys.every((k) => VISUAL_KEYS.has(k));
      if (onlyVisual) applyAppearance(state.popupEl);
      else renderPopup();
    }
  });
  function applyAppearance(pop) {
    pop.className = `lens-root lens-popup ${state.dark ? 'lens-dark' : ''}`;
    pop.setAttribute('data-tint', state.tint);
    pop.style.width = state.popupWidth + 'px';
    pop.style.setProperty('--lens-fs', state.fontSize + 'px');
  }
  function extractContext(range) {
    try {
      if (!range) return '';
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      if (!node) return '';
      let container = null, cur = node;
      for (let i = 0; cur && i < 15; i++) {
        if (cur.nodeType === 1 && cur !== document.body) {
          const t = (cur.textContent || '').trim();
          if (t.length >= 200) { container = cur; break; }
        }
        cur = cur.parentElement;
      }
      if (!container) return '';
      let ctx = (container.textContent || '').replace(/\s+/g, ' ').trim();
      if (ctx.length <= 2500) return ctx;
      const sel = (range.toString() || '').replace(/\s+/g, ' ').trim();
      const idx = sel ? ctx.indexOf(sel) : -1;
      if (idx >= 0) {
        const s = Math.max(0, idx - 1100);
        const e = Math.min(ctx.length, idx + sel.length + 1100);
        return (s > 0 ? '…' : '') + ctx.slice(s, e) + (e < ctx.length ? '…' : '');
      }
      return ctx.slice(0, 2200) + '…';
    } catch (e) { return ''; }
  }

  // ── Selection listener ───────────────────────────────────────────────────
  const lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  document.addEventListener('pointerup', (e) => { lastPointer.x = e.clientX; lastPointer.y = e.clientY; }, true);
  document.addEventListener('mouseup', onMouseUp, true);
  // Keyboard selections (shift+arrows, select-all): evaluate promptly on keyup.
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift' || ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A'))) {
      setTimeout(evaluateSelection, 4);
    }
  }, true);
  // selectionchange is the reliability net: it fires for keyboard selections
  // (shift+arrows, select-all), for drags released outside the window, and on
  // sites whose own handlers swallow mouseup. Debounced so the trigger appears
  // once the selection settles rather than flickering during the drag.
  let selDebounce = null;
  document.addEventListener('selectionchange', () => {
    if (selDebounce) clearTimeout(selDebounce);
    selDebounce = setTimeout(() => evaluateSelection(), 150);
  });

  function evaluateSelection() {
    if (!state.enabled) return;
    const s = window.getSelection();
    if (!s || s.isCollapsed) {
      if (state.pending) { state.pending = null; renderTrigger(); }
      return;
    }
    const text = s.toString().trim();
    if (text.length < 4) {
      if (state.pending) { state.pending = null; renderTrigger(); }
      return;
    }
    // Skip if same as current popup content
    if (state.selection && state.selection.text === text) {
      if (state.pending) { state.pending = null; renderTrigger(); }
      return;
    }
    // Already showing the trigger for this exact selection: don't re-render.
    if (state.pending && state.pending.text === text) return;
    let range = null, rect = null;
    try {
      range = s.getRangeAt(0);
      rect = range.getBoundingClientRect();
    } catch (err) { /* shadow-DOM selections can refuse a range */ }
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      // Shadow-DOM / synthetic selections report no geometry: fall back to
      // where the pointer last was so the button still appears.
      rect = { top: Math.max(8, lastPointer.y - 12), left: Math.max(8, lastPointer.x - 40), width: 80, height: 24 };
    }
    state.pending = {
      text,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      context: range ? extractContext(range) : '',
      title: document.title || '',
    };
    renderTrigger();
  }

  function onMouseUp(e) {
    if (!state.enabled) return;
    // Ignore clicks inside our own UI
    if (e.target && e.target.closest && e.target.closest('.lens-root')) return;
    setTimeout(evaluateSelection, 4);
  }

  // ── Keyboard shortcut (handled by Chrome command + a JS fallback) ────────
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E')) {
      if (state.pending) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openFromPending();
      }
    } else if (e.key === 'Escape' && state.popupEl) {
      closePopup();
    }
  }, true);

  // Listen for the chrome command (defined in manifest)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'lens-explain-shortcut') {
      if (msg.text && (!state.pending || state.pending.text !== msg.text)) {
        openFromText(msg.text);
      } else if (state.pending) {
        openFromPending();
      }
    }
    if (msg && msg.type === 'lens-open-from-history' && msg.text) {
      openFromText(msg.text);
    }
    if (msg && msg.type === 'lens-toggle-enabled') {
      state.enabled = msg.enabled;
      if (!msg.enabled) { closePopup(); removeTrigger(); }
    }
  });

  // ── Floating Explain button ──────────────────────────────────────────────
  function renderTrigger() {
    removeTrigger();
    if (!state.pending) return;
    const r = state.pending.rect;
    const wrap = document.createElement('div');
    wrap.className = 'lens-root lens-trigger-wrap';
    wrap.style.top = (r.top - 38) + 'px';
    wrap.style.left = (r.left + r.width / 2 - 50) + 'px';
    wrap.innerHTML = `
      <button class="lens-trigger">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M9.5 9.5L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>Explain</span>
        <span class="lens-kbd">⌘E</span>
      </button>`;
    wrap.querySelector('button').addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    wrap.querySelector('button').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openFromPending();
    });
    document.body.appendChild(wrap);
    state.triggerEl = wrap;
  }
  function removeTrigger() {
    if (state.triggerEl) { state.triggerEl.remove(); state.triggerEl = null; }
  }

  function openFromPending() {
    if (!state.pending) return;
    state.selection = { text: state.pending.text, rect: state.pending.rect, context: state.pending.context || '', title: state.pending.title || '' };
    state.pending = null;
    removeTrigger();
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    state.tab = 'explain';
    state.mode = 'simple';
    state.followUps = [];
    renderPopup();
    loadExplanation();
    checkSaved();
  }

  function openFromText(text) {
    state.selection = {
      text,
      rect: {
        top: window.innerHeight / 2 - 12,
        left: window.innerWidth / 2 - 100,
        width: 200, height: 24,
      },
      context: '',
      title: document.title || '',
    };
    state.tab = 'explain';
    state.mode = 'simple';
    state.followUps = [];
    renderPopup();
    loadExplanation();
    checkSaved();
  }

  function closePopup() {
    if (state.streamTimer) { clearTimeout(state.streamTimer); state.streamTimer = null; }
    if (state.popupEl) { state.popupEl.remove(); state.popupEl = null; }
    state.selection = null;
    state.userPos = null;
  }

  // ── Popup render ─────────────────────────────────────────────────────────
  function computePos() {
    if (state.userPos) return state.userPos;
    const r = state.selection.rect;
    const w = state.popupWidth;
    const margin = 16;
    let left = r.left + r.width + 24;
    if (left + w + margin > window.innerWidth) left = r.left - w - 24;
    if (left < margin) left = margin;
    let top = r.top - 20;
    const maxTop = window.innerHeight - 380 - margin;
    if (top > maxTop) top = Math.max(margin, maxTop);
    if (top < margin) top = margin;
    return { left, top };
  }

  function renderPopup() {
    if (!state.selection) return;
    if (!state.popupEl) {
      state.popupEl = document.createElement('div');
      state.popupEl.className = 'lens-root lens-popup';
      document.body.appendChild(state.popupEl);
    }
    const pop = state.popupEl;
    pop.className = `lens-root lens-popup ${state.dark ? 'lens-dark' : ''}`;
    pop.setAttribute('data-tint', state.tint);
    const pos = computePos();
    pop.style.left = pos.left + 'px';
    pop.style.top = pos.top + 'px';
    pop.style.width = state.popupWidth + 'px';
    pop.style.setProperty('--lens-fs', state.fontSize + 'px');

    const quoteTrim = state.selection.text.length > 220
      ? state.selection.text.slice(0, 220) + '…' : state.selection.text;

    pop.innerHTML = `
      <div class="lens-hd">
        <div class="lens-drag-grip"><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <div class="lens-source">
          <span class="lens-dot"></span>
          <span>Lens · reading companion</span>
        </div>
        <div class="lens-hd-actions">
          <button class="lens-icon-btn" data-act="close" title="Close (Esc)" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      <div class="lens-quote">
        <div class="lens-quote-bar"></div>
        <div class="lens-quote-text">"${escapeHtml(quoteTrim)}"</div>
      </div>
      <div class="lens-tabs">
        ${['explain','define','related','followup'].map((id) => `
          <button class="lens-tab ${state.tab === id ? 'is-active' : ''}" data-tab="${id}">
            ${ ({explain:'Explain', define:'Define', related:'Related', followup:'Ask'})[id] }
          </button>`).join('')}
      </div>
      <div class="lens-body" data-body></div>
      <div class="lens-ft">
        <button class="lens-ft-btn" data-act="copy">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V3H11" stroke="currentColor" stroke-width="1.2"/></svg>
          <span data-copy-label>Copy</span>
        </button>
        <button class="lens-ft-btn ${state.isSaved ? 'is-on' : ''}" data-act="save">
          <svg width="11" height="11" viewBox="0 0 16 16"><path d="M4 2H12V14L8 11L4 14V2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="${state.isSaved ? 'currentColor' : 'none'}"/></svg>
          <span data-save-label>${state.isSaved ? 'Saved' : 'Save'}</span>
        </button>
        <div class="lens-ft-spacer"></div>
        <div class="lens-ft-kbd">Esc to close</div>
      </div>
    `;

    pop.querySelector('.lens-hd').addEventListener('mousedown', onDragStart);
    pop.querySelectorAll('.lens-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        renderPopup();
        renderBody();
      });
    });
    pop.querySelector('[data-act="close"]').addEventListener('click', closePopup);
    pop.querySelector('[data-act="copy"]').addEventListener('click', onCopy);
    pop.querySelector('[data-act="save"]').addEventListener('click', onSave);
    renderBody();
  }

  function renderBody() {
    if (!state.popupEl) return;
    const body = state.popupEl.querySelector('[data-body]');
    if (!body) return;
    if (state.tab === 'explain') renderExplainBody(body);
    else if (state.tab === 'define') renderDefineBody(body);
    else if (state.tab === 'related') renderRelatedBody(body);
    else if (state.tab === 'followup') renderFollowUpBody(body);
  }

  function renderExplainBody(body) {
    const cacheKey = state.selection.text + '|' + state.mode;
    const cached = state.cache.get(cacheKey);
    const loading = !cached;
    body.innerHTML = `
      <div class="lens-mode-row">
        <div class="lens-mode-seg">
          <button data-mode="simple" class="${state.mode === 'simple' ? 'is-active' : ''}">Plain English</button>
          <button data-mode="technical" class="${state.mode === 'technical' ? 'is-active' : ''}">Technical</button>
        </div>
      </div>
      ${loading ? `
        <div class="lens-shimmer">
          <div class="lens-shim-line" style="width:92%"></div>
          <div class="lens-shim-line" style="width:86%"></div>
          <div class="lens-shim-line" style="width:74%"></div>
          <div class="lens-shim-line" style="width:88%"></div>
          <div class="lens-shim-line" style="width:60%"></div>
        </div>` : `
        <div class="lens-explanation" data-explanation></div>
      `}
    `;
    body.querySelectorAll('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        // Clicking the already-active mode retries if the last attempt failed.
        if (state.mode === b.dataset.mode && state.cache.has(cacheKey)) return;
        state.mode = b.dataset.mode;
        loadExplanation();
        renderBody();
      });
    });
    if (cached) {
      // Start (or restart) the typewriter stream.
      startStream(cached, body.querySelector('[data-explanation]'));
    } else {
      // Nothing cached (first load, or a previous attempt failed) — fetch.
      loadExplanation();
    }
  }

  function renderDefineBody(body) {
    const cacheKey = 'define|' + state.selection.text;
    const cached = state.cache.get(cacheKey);
    if (!cached) {
      body.innerHTML = `<div class="lens-shimmer">
        <div class="lens-shim-line" style="width:40%"></div>
        <div class="lens-shim-line" style="width:88%"></div>
        <div class="lens-shim-line" style="width:36%"></div>
        <div class="lens-shim-line" style="width:82%"></div>
      </div>`;
      loadDefine();
      return;
    }
    body.innerHTML = `<div class="lens-list">${cached.map((d) => `
      <div class="lens-def">
        <div class="lens-def-term">${escapeHtml(d.term)}</div>
        <div class="lens-def-text">${escapeHtml(d.def)}</div>
      </div>`).join('')}</div>`;
  }

  function renderRelatedBody(body) {
    const cacheKey = 'related|' + state.selection.text;
    const cached = state.cache.get(cacheKey);
    if (!cached) {
      body.innerHTML = `<div class="lens-shimmer">
        <div class="lens-shim-line" style="width:78%"></div>
        <div class="lens-shim-line" style="width:64%"></div>
        <div class="lens-shim-line" style="width:82%"></div>
      </div>`;
      loadRelated();
      return;
    }
    body.innerHTML = `<div class="lens-list">${cached.map((r) => `
      <div class="lens-related">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M5 11L11 5M11 5H6.5M11 5V9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        <span>${escapeHtml(r)}</span>
      </div>`).join('')}</div>`;
  }

  function renderFollowUpBody(body) {
    body.innerHTML = `
      <div class="lens-followup">
        ${state.followUps.length === 0 && !state.followLoading
          ? `<div class="lens-followup-empty">Ask a follow-up about this passage.</div>` : ''}
        ${state.followUps.map((f) => `
          <div class="lens-followup-pair">
            <div class="lens-followup-q">${escapeHtml(f.q)}</div>
            <div class="lens-followup-a">${escapeHtml(f.a)}</div>
          </div>`).join('')}
        ${state.followLoading ? `<div class="lens-shimmer" style="margin-top:6px">
          <div class="lens-shim-line" style="width:84%"></div>
          <div class="lens-shim-line" style="width:62%"></div>
        </div>` : ''}
        <div class="lens-followup-input-row">
          <input class="lens-followup-input" placeholder="What does this term mean here?" data-followup-input />
          <button class="lens-followup-send" data-followup-send>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8L14 2L9 14L7.5 9L2 8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/></svg>
          </button>
        </div>
      </div>`;
    const input = body.querySelector('[data-followup-input]');
    const send = body.querySelector('[data-followup-send]');
    const submit = async () => {
      const q = input.value.trim();
      if (!q || state.followLoading) return;
      input.value = '';
      state.followLoading = true;
      renderBody();
      try {
        const a = await callBackground('followup', {
          text: state.selection.text,
          context: state.selection.context,
          title: state.selection.title,
          conversation: [
            { role: 'assistant', content: state.cache.get(state.selection.text + '|' + state.mode) || '' },
            ...state.followUps.flatMap((f) => [{ role: 'user', content: f.q }, { role: 'assistant', content: f.a }]),
          ],
          question: q,
        });
        state.followUps.push({ q, a });
      } catch (e) {
        state.followUps.push({ q, a: 'Error: ' + e.message });
      }
      state.followLoading = false;
      renderBody();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    send.addEventListener('click', submit);
    input.focus();
  }

  // ── API calls (proxied through background service worker) ────────────────
  async function loadExplanation() {
    const cacheKey = state.selection.text + '|' + state.mode;
    if (state.cache.has(cacheKey)) {
      // Re-render to start the stream
      renderBody();
      return;
    }
    if (state.inflight.has(cacheKey)) return;
    state.inflight.add(cacheKey);
    try {
      const text = await callBackground('explain', { text: state.selection.text, mode: state.mode, context: state.selection.context, title: state.selection.title });
      state.cache.set(cacheKey, text);
      // Append to history
      addToHistory({ text: state.selection.text, explanation: text, ts: Date.now() });
      // Update view
      if (state.tab === 'explain') renderBody();
    } catch (e) {
      // Show the error but don't keep it cached — the engine may just be
      // mid-download, so switching modes/tabs (or re-opening) retries.
      state.cache.set(cacheKey, "Couldn't get an explanation: " + e.message);
      if (state.tab === 'explain') renderBody();
      state.cache.delete(cacheKey);
    } finally {
      state.inflight.delete(cacheKey);
    }
  }

  async function loadDefine() {
    const cacheKey = 'define|' + state.selection.text;
    if (state.cache.has(cacheKey) || state.inflight.has(cacheKey)) return;
    state.inflight.add(cacheKey);
    try {
      const defs = await callBackground('define', { text: state.selection.text, context: state.selection.context, title: state.selection.title });
      state.cache.set(cacheKey, defs);
      if (state.tab === 'define') renderBody();
    } catch (e) {
      state.cache.set(cacheKey, [{ term: 'Error', def: e.message }]);
      if (state.tab === 'define') renderBody();
      state.cache.delete(cacheKey); // errors aren't cached; re-opening the tab retries
    } finally {
      state.inflight.delete(cacheKey);
    }
  }

  async function loadRelated() {
    const cacheKey = 'related|' + state.selection.text;
    if (state.cache.has(cacheKey) || state.inflight.has(cacheKey)) return;
    state.inflight.add(cacheKey);
    try {
      const r = await callBackground('related', { text: state.selection.text, context: state.selection.context, title: state.selection.title });
      state.cache.set(cacheKey, r);
      if (state.tab === 'related') renderBody();
    } catch (e) {
      state.cache.set(cacheKey, ['Error: ' + e.message]);
      if (state.tab === 'related') renderBody();
      state.cache.delete(cacheKey); // errors aren't cached; re-opening the tab retries
    } finally {
      state.inflight.delete(cacheKey);
    }
  }

  function callBackground(action, payload) {
    return new Promise((res, rej) => {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
        if (!response) return rej(new Error('No response from background'));
        if (response.error) return rej(new Error(response.error));
        res(response.result);
      });
    });
  }

  // ── Stream typewriter ────────────────────────────────────────────────────
  function startStream(fullText, targetEl) {
    if (state.streamTimer) { clearTimeout(state.streamTimer); state.streamTimer = null; }
    if (!targetEl) return;
    // If we're re-rendering the same content, skip the animation.
    if (state.streamingFor === fullText && targetEl.dataset.complete === '1') {
      targetEl.textContent = fullText;
      return;
    }
    state.streamingFor = fullText;
    targetEl.textContent = '';
    let i = 0;
    const step = Math.max(1, Math.round(state.streamSpeed));
    const tick = () => {
      i += step;
      if (i >= fullText.length) {
        targetEl.textContent = fullText;
        targetEl.dataset.complete = '1';
        state.streamTimer = null;
        return;
      }
      targetEl.textContent = fullText.slice(0, i);
      // Add caret
      const caret = document.createElement('span');
      caret.className = 'lens-caret';
      targetEl.appendChild(caret);
      state.streamTimer = setTimeout(tick, 14);
    };
    tick();
    // Click to finish
    targetEl.addEventListener('click', () => {
      if (state.streamTimer) {
        clearTimeout(state.streamTimer);
        state.streamTimer = null;
        targetEl.textContent = fullText;
        targetEl.dataset.complete = '1';
      }
    }, { once: true });
  }

  // ── Dragging ─────────────────────────────────────────────────────────────
  function onDragStart(e) {
    if (e.target.closest && e.target.closest('button')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const rect = state.popupEl.getBoundingClientRect();
    const startLeft = rect.left, startTop = rect.top;
    state.popupEl.classList.add('is-dragging');
    const onMove = (ev) => {
      const w = state.popupEl.offsetWidth;
      const h = state.popupEl.offsetHeight;
      const left = Math.min(window.innerWidth - w - 8, Math.max(8, startLeft + (ev.clientX - startX)));
      const top = Math.min(window.innerHeight - h - 8, Math.max(8, startTop + (ev.clientY - startY)));
      state.userPos = { left, top };
      state.popupEl.style.left = left + 'px';
      state.popupEl.style.top = top + 'px';
    };
    const onUp = () => {
      state.popupEl.classList.remove('is-dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Copy / Save ──────────────────────────────────────────────────────────
  function onCopy() {
    const cacheKey = state.selection.text + '|' + state.mode;
    const text = state.cache.get(cacheKey) || '';
    navigator.clipboard.writeText(text).catch(() => {});
    const lbl = state.popupEl.querySelector('[data-copy-label]');
    if (lbl) { lbl.textContent = 'Copied'; setTimeout(() => lbl.textContent = 'Copy', 1500); }
  }

  function onSave() {
    chrome.storage.local.get(['saved'], ({ saved }) => {
      saved = saved || [];
      const idx = saved.findIndex((s) => s.text === state.selection.text);
      if (idx >= 0) {
        saved.splice(idx, 1);
        state.isSaved = false;
      } else {
        const cacheKey = state.selection.text + '|' + state.mode;
        saved.unshift({
          text: state.selection.text,
          explanation: state.cache.get(cacheKey) || '',
          ts: Date.now(),
        });
        state.isSaved = true;
      }
      chrome.storage.local.set({ saved });
      // Update the button label/fill in place
      const btn = state.popupEl.querySelector('[data-act="save"]');
      const lbl = state.popupEl.querySelector('[data-save-label]');
      const svgPath = btn.querySelector('path');
      if (state.isSaved) {
        btn.classList.add('is-on');
        if (lbl) lbl.textContent = 'Saved';
        if (svgPath) svgPath.setAttribute('fill', 'currentColor');
      } else {
        btn.classList.remove('is-on');
        if (lbl) lbl.textContent = 'Save';
        if (svgPath) svgPath.setAttribute('fill', 'none');
      }
    });
  }

  function checkSaved() {
    chrome.storage.local.get(['saved'], ({ saved }) => {
      saved = saved || [];
      state.isSaved = saved.some((s) => s.text === state.selection.text);
      if (state.popupEl) renderPopup();
    });
  }

  // ── History ──────────────────────────────────────────────────────────────
  function addToHistory(item) {
    chrome.storage.local.get(['history'], ({ history }) => {
      history = history || [];
      const filtered = history.filter((h) => h.text !== item.text);
      const next = [item, ...filtered].slice(0, 200);
      chrome.storage.local.set({ history: next });
    });
  }

  // ── Utils ────────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  loadSettings();
})();
