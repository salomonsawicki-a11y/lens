// Lens PDF viewer — single-core, lazy rendering.
// Page 1 renders immediately; remaining pages render on demand as they scroll
// into view (IntersectionObserver). Large papers open instantly, scroll
// normally, and are selectable page-by-page. content.js (loaded by
// viewer.html) provides the existing highlight -> Explain popup.

import * as pdfjsLib from './build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('./build/pdf.worker.mjs', import.meta.url).href;

const CMAP_URL = new URL('./cmaps/', import.meta.url).href;
const FONT_URL = new URL('./standard_fonts/', import.meta.url).href;
const WASM_URL = new URL('./wasm/', import.meta.url).href;

const statusEl = document.getElementById('status');
const statusBox = document.getElementById('statusBox');
const viewerEl = document.getElementById('viewer');
const containerEl = document.getElementById('viewerContainer');

function showStatus(h) { statusBox.innerHTML = h; statusEl.hidden = false; }
function hideStatus() { statusEl.hidden = true; }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const params = new URLSearchParams(location.search);
const fileUrl = params.get('file') ? decodeURIComponent(params.get('file')) : '';

document.getElementById('openOriginal').addEventListener('click', () => {
  if (fileUrl) location.href = fileUrl;
});

let pdfDoc = null;
let userScale = null;            // null => fit width
let baseW = 612, baseH = 792;    // page-1 dimensions in PDF points
let observer = null;
const rendered = new Set();
const inflight = new Set();

if (!fileUrl) {
  showStatus('<div><strong>No PDF specified.</strong><br>Paste a PDF URL:' +
    '<input id="manualUrl" placeholder="https://\u2026/paper.pdf" /></div>');
  const inp = document.getElementById('manualUrl');
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inp.value.trim())
      location.search = '?file=' + encodeURIComponent(inp.value.trim());
  });
} else {
  load();
}

document.getElementById('zoomIn').addEventListener('click',
  () => { userScale = scale() * 1.15; relayout(); });
document.getElementById('zoomOut').addEventListener('click',
  () => { userScale = scale() / 1.15; relayout(); });
document.getElementById('fitWidth').addEventListener('click',
  () => { userScale = null; relayout(); });

function scale() {
  if (userScale) return userScale;
  const avail = (containerEl.clientWidth || 800) - 36;
  return Math.max(0.2, avail / baseW);
}

async function load() {
  showStatus('<div>Opening PDF\u2026</div>');
  try {
    const task = pdfjsLib.getDocument({
      url: fileUrl,
      cMapUrl: CMAP_URL, cMapPacked: true,
      standardFontDataUrl: FONT_URL,
      wasmUrl: WASM_URL,
      isEvalSupported: false,
    });
    pdfDoc = await task.promise;
    document.title = 'Lens \u00b7 ' + (fileUrl.split('/').pop() || 'PDF');
    const p1 = await pdfDoc.getPage(1);
    const vp1 = p1.getViewport({ scale: 1 });
    baseW = vp1.width; baseH = vp1.height;
    hideStatus();
    layout();
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    const isFile = fileUrl.startsWith('file:');
    showStatus('<div><strong>Couldn\u2019t load this PDF.</strong><br><br>' +
      esc(msg) +
      (isFile ? '<br><br>For local <code>file://</code> PDFs, enable ' +
        '<em>Allow access to file URLs</em> at <code>chrome://extensions</code> ' +
        '&rarr; Lens &rarr; Details.' : '') +
      '<br><br><a href="' + esc(fileUrl) +
      '">Open in Chrome\u2019s viewer instead</a></div>');
  }
}

function layout() {
  const s = scale();
  const w = Math.floor(baseW * s);
  const h = Math.floor(baseH * s);
  viewerEl.textContent = '';
  rendered.clear(); inflight.clear();
  if (observer) observer.disconnect();

  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    pageDiv.dataset.page = String(n);
    pageDiv.style.width = w + 'px';
    pageDiv.style.height = h + 'px';
    pageDiv.style.setProperty('--scale-factor', String(s));
    pageDiv.style.setProperty('--total-scale-factor', String(s));
    viewerEl.appendChild(pageDiv);
  }

  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) renderPage(+e.target.dataset.page, s);
    }
  }, { root: containerEl, rootMargin: '600px 0px' });

  viewerEl.querySelectorAll('.page').forEach((el) => observer.observe(el));
}

function relayout() { if (pdfDoc) layout(); }

async function renderPage(n, s) {
  if (rendered.has(n) || inflight.has(n)) return;
  inflight.add(n);
  const pageDiv = viewerEl.querySelector('.page[data-page="' + n + '"]');
  if (!pageDiv) { inflight.delete(n); return; }
  try {
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale: s });
    pageDiv.style.width = Math.floor(viewport.width) + 'px';
    pageDiv.style.height = Math.floor(viewport.height) + 'px';

    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    const ctx = canvas.getContext('2d', { alpha: false });

    const textDiv = document.createElement('div');
    textDiv.className = 'textLayer';

    pageDiv.appendChild(canvas);
    pageDiv.appendChild(textDiv);

    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;

    const tl = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container: textDiv,
      viewport,
    });
    await tl.render();
    page.cleanup();
    rendered.add(n);
  } catch (err) {
    if (!(err && err.name === 'RenderingCancelledException')) {
      const m = (err && err.message) ? err.message : String(err);
      const note = document.createElement('div');
      note.style.cssText =
        'color:#c0392b;padding:14px;font:12px sans-serif;text-align:center';
      note.textContent = 'Page ' + n + ' failed: ' + m;
      pageDiv.appendChild(note);
    }
  } finally {
    inflight.delete(n);
  }
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!pdfDoc || userScale) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 200);
});
