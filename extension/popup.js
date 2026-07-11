// Toolbar popup logic — shows history & saved tabs, clicking an item asks the
// content script to re-open the explainer with that sentence.

let history = [];
let saved = [];
let tab = 'history';

const els = {
  body: document.getElementById('body'),
  histN: document.getElementById('histN'),
  savedN: document.getElementById('savedN'),
  histCount: document.getElementById('histCount'),
  savedCount: document.getElementById('savedCount'),
  optionsBtn: document.getElementById('optionsBtn'),
  clearBtn: document.getElementById('clearBtn'),
};

function load() {
  chrome.storage.local.get(['history', 'saved'], (s) => {
    history = s.history || [];
    saved = s.saved || [];
    els.histN.textContent = history.length;
    els.savedN.textContent = history.length;
    els.histCount.textContent = history.length;
    els.savedCount.textContent = saved.length;
    render();
  });
}

function render() {
  if (tab === 'appearance') return renderAppearance();
  const items = tab === 'history' ? history : saved;
  if (items.length === 0) {
    els.body.innerHTML = `<div class="empty">${
      tab === 'history'
        ? 'No history yet. Highlight text on any page and click <strong>Explain</strong>.'
        : 'No saved explanations. Click <strong>Save</strong> in the popup to bookmark one.'
    }</div>`;
    return;
  }
  const savedSet = new Set(saved.map((s) => s.text));
  els.body.innerHTML = items.map((it, i) => {
    const isBookmark = tab === 'history' && savedSet.has(it.text);
    const quote = it.text.length > 110 ? it.text.slice(0, 110) + '…' : it.text;
    const exp = (it.explanation || '').slice(0, 180);
    const time = new Date(it.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="item" data-idx="${i}">
        <div class="item-row">
          <div class="item-q">"${escapeHtml(quote)}"</div>
          ${isBookmark ? '<svg class="item-bookmark" width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2H12V14L8 11L4 14V2Z"/></svg>' : ''}
        </div>
        <div class="item-e">${escapeHtml(exp)}${(it.explanation || '').length > 180 ? '…' : ''}</div>
        <div class="item-meta"><span>${time}</span><span class="go">re-explain →</span></div>
      </div>
    `;
  }).join('');
  els.body.querySelectorAll('.item').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = +el.dataset.idx;
      const item = items[idx];
      if (!item) return;
      // Ask the background to relay to the active tab.
      chrome.runtime.sendMessage({ action: 'open-from-history', text: item.text }, () => {
        window.close();
      });
    });
  });
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    tab = btn.dataset.tab;
    document.body.classList.toggle('on-appearance', tab === 'appearance');
    render();
  });
});

els.optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

els.clearBtn.addEventListener('click', () => {
  if (!confirm(`Clear ${tab === 'history' ? 'history' : 'saved explanations'}?`)) return;
  if (tab === 'history') chrome.storage.local.set({ history: [] }, load);
  else chrome.storage.local.set({ saved: [] }, load);
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

load();


function renderAppearance() {
  chrome.storage.local.get(['dark','tint','popupWidth','fontSize','streamSpeed'], (s) => {
    const tint = s.tint || 'violet';
    const dark = !!s.dark;
    const pw = s.popupWidth || 360, fs = s.fontSize || 13, ss = s.streamSpeed || 3;
    const sw = { violet:'#a78bfa', slate:'#94a3b8', amber:'#f59e0b' };
    els.body.innerHTML = `
      <div class="appearance">
        <div class="ap-row"><div class="ap-lbl">Tint</div><div class="ap-tints">${['violet','slate','amber'].map(t=>`<button class="ap-tint${t===tint?' is-active':''}" data-tint="${t}" title="${t}" style="--c: ${sw[t]}"></button>`).join('')}</div></div>
        <div class="ap-row"><div class="ap-lbl">Dark mode</div><button class="ap-toggle" id="apDark" data-on="${dark?1:0}" aria-label="Dark mode"><i></i></button></div>
        <div class="ap-row ap-col"><div class="ap-lbl-row"><span class="ap-lbl">Popup width</span><span class="ap-val" id="apPopupWidthVal">${pw}px</span></div><input type="range" id="apPopupWidth" min="280" max="460" step="10" value="${pw}"></div>
        <div class="ap-row ap-col"><div class="ap-lbl-row"><span class="ap-lbl">Font size</span><span class="ap-val" id="apFontSizeVal">${fs}px</span></div><input type="range" id="apFontSize" min="11" max="16" step="1" value="${fs}"></div>
        <div class="ap-row ap-col"><div class="ap-lbl-row"><span class="ap-lbl">Stream speed</span><span class="ap-val" id="apStreamSpeedVal">${ss}</span></div><input type="range" id="apStreamSpeed" min="1" max="20" step="1" value="${ss}"></div>
      </div>`;
    els.body.querySelectorAll('.ap-tint').forEach((b)=>b.addEventListener('click',()=>{ chrome.storage.local.set({tint:b.dataset.tint}); els.body.querySelectorAll('.ap-tint').forEach(x=>x.classList.toggle('is-active',x===b)); }));
    const db=document.getElementById('apDark');
    db.addEventListener('click',()=>{ const n=db.dataset.on!=='1'; db.dataset.on=n?'1':'0'; chrome.storage.local.set({dark:n}); });
    const bind=(id,key,suf)=>{ const i=document.getElementById(id), l=document.getElementById(id+'Val');
      i.addEventListener('input',()=>{ l.textContent=i.value+(suf||''); });
      i.addEventListener('change',()=>{ chrome.storage.local.set({[key]:+i.value}); }); };
    bind('apPopupWidth','popupWidth','px'); bind('apFontSize','fontSize','px'); bind('apStreamSpeed','streamSpeed','');
  });
}
