/* Marginalia for Android: the app's screens and behaviour */

import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { api, DEFAULT_MODEL } from './engine.js';
import { fmt } from './chapters.js';
import { buildPdfBase64, savePdf, shareText } from './pdf.js';

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  video: null, // { videoId, title, author, duration, hasTranscript, chapters, topicsSource }
  selected: new Set(),
  sections: [], // { id, title, start, end, md, shortMd, status: queued|working|done|error|editing, error, shortError, edited }
  busy: false,
  zoom: 1,
  view: 'full', // 'full' or 'short'
  tab: 'lecture',
  scroll: { lecture: 0, notes: 0 },
};

/* ---------- helpers ---------- */

const store = {
  get(k, d = '') {
    try { return localStorage.getItem('marginalia.' + k) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('marginalia.' + k, v); } catch { /* storage blocked */ }
  },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtLen(sec) {
  if (!sec || sec < 1) return '';
  if (sec < 60) return '<1 min';
  const total = Math.round(sec / 60);
  const h = Math.floor(total / 60), m = total % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${total} min`;
}

const slug = (s) => (String(s).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'lecture').slice(0, 60);

function showMsg(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
}

const getAuth = () => ({ apiKey: store.get('key').trim(), model: store.get('model').trim() || DEFAULT_MODEL });
const getOpts = () => ({
  detail: $('#opt-detail').value,
  language: $('#opt-language').value,
  practice: $('#opt-practice').checked,
  diagrams: $('#opt-diagrams').checked,
});

function openExternal(url) {
  if (Capacitor.isNativePlatform()) Browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

/* ---------- markdown, math and diagrams ---------- */

let figureCount = 0;
let pendingDiagrams = Promise.resolve();

const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Several SVGs share one page, so give each one's ids (arrow markers etc.) a unique prefix.
function scopeIds(svg, n) {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  ids.forEach((id) => {
    const safe = `fig${n}-${id}`;
    svg = svg
      .replace(new RegExp(`\\sid="${reEsc(id)}"`, 'g'), ` id="${safe}"`)
      .replace(new RegExp(`url\\(#${reEsc(id)}\\)`, 'g'), `url(#${safe})`)
      .replace(new RegExp(`href="#${reEsc(id)}"`, 'g'), `href="#${safe}"`);
  });
  return svg;
}

function svgFigure(code) {
  const m = String(code).match(/<svg[\s\S]*<\/svg>/i);
  if (!m || !window.DOMPurify) return '';
  let svg = DOMPurify.sanitize(m[0], { USE_PROFILES: { svg: true, svgFilters: true } });
  if (!/^\s*<svg/i.test(svg)) return '';

  svg = svg.replace(/<svg\b([^>]*)>/i, (all, attrs) => {
    const w = attrs.match(/\swidth="([\d.]+)/);
    const h = attrs.match(/\sheight="([\d.]+)/);
    let out = attrs.replace(/\s(?:width|height)="[^"]*"/gi, '');
    if (!/viewBox/i.test(out)) out += ` viewBox="0 0 ${w && h ? `${w[1]} ${h[1]}` : '640 360'}"`;
    return `<svg${out}>`;
  });
  return `<figure class="diagram">${scopeIds(svg, ++figureCount)}</figure>`;
}

function renderMd(md) {
  const maths = [];
  const figures = [];
  const hold = (tex, display) => `MATHTOKEN${maths.push({ tex, display }) - 1}END`;

  // 1. pull diagram blocks out first (SVG text can contain $ or backslashes)
  let s = String(md).replace(
    /```(svg|mermaid)[ \t]*\r?\n([\s\S]*?)```/gi,
    (_, lang, code) => `\n\nDIAGRAMTOKEN${figures.push({ lang: lang.toLowerCase(), code }) - 1}END\n\n`
  );

  // 2. math
  s = s
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => '$$' + t.trim() + '$$')
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => '$' + t.trim() + '$');
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => hold(t, true));
  s = s.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_, t) => hold(t, false));

  let html = window.marked ? marked.parse(s, { gfm: true }) : `<p>${esc(s)}</p>`;
  html = window.DOMPurify ? DOMPurify.sanitize(html) : html;

  // 3. put diagrams back
  html = html.replace(/(?:<p>\s*)?DIAGRAMTOKEN(\d+)END(?:\s*<\/p>)?/g, (_, i) => {
    const f = figures[Number(i)];
    if (!f) return '';
    return f.lang === 'svg' ? svgFigure(f.code) : `<figure class="diagram mermaid-slot" data-code="${esc(f.code)}"></figure>`;
  });

  // 4. put math back
  return html.replace(/MATHTOKEN(\d+)END/g, (_, i) => {
    const m = maths[Number(i)];
    if (!m) return '';
    try {
      return katex.renderToString(m.tex.trim(), { displayMode: m.display, throwOnError: false, output: 'html' });
    } catch {
      return esc(m.tex);
    }
  });
}

// Mermaid diagrams are drawn after the page text is in place.
let mermaidReady = false;
let mermaidCount = 0;

async function drawMermaid(root) {
  const slots = [...root.querySelectorAll('.mermaid-slot')];
  for (const slot of slots) {
    const code = slot.dataset.code || '';
    const failed = () => {
      slot.classList.remove('mermaid-slot');
      slot.innerHTML = '<span class="n-wait no-pdf">A flowchart could not be drawn here. Use “Regenerate”, or edit the text.</span>';
    };
    if (!window.mermaid) { failed(); continue; }
    if (!mermaidReady) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        flowchart: { htmlLabels: false, curve: 'basis' },
        themeVariables: { fontFamily: "'DM Sans', sans-serif", fontSize: '15px', primaryColor: '#eef1fb', primaryBorderColor: '#2a44b3', primaryTextColor: '#1f1f1f', lineColor: '#1f2a44' },
      });
      mermaidReady = true;
    }
    const id = `mmd${++mermaidCount}`;
    try {
      await mermaid.parse(code);
      const { svg } = await mermaid.render(id, code);
      slot.classList.remove('mermaid-slot');
      slot.innerHTML = svg;
    } catch {
      document.getElementById(`d${id}`)?.remove();
      failed();
    }
  }
}

/* ---------- theme and text size ---------- */

$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.set('theme', next);
});

function setZoom(z) {
  z = Math.min(1.6, Math.max(0.8, Math.round(z * 10) / 10));
  state.zoom = z;
  $('#sheet').style.setProperty('--zoom', String(z));
  $('#zoom-reset').textContent = `${Math.round(z * 100)}%`;
  store.set('zoom', String(z));
}
$('#zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.1));
$('#zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.1));
$('#zoom-reset').addEventListener('click', () => setZoom(1));

/* ---------- full and short versions ---------- */

const viewMd = (s) => (state.view === 'short' && s.shortMd ? s.shortMd : s.md);
function setViewMd(s, value) {
  if (state.view === 'short' && s.shortMd) s.shortMd = value;
  else s.md = value;
}

function syncView() {
  const short = state.view === 'short';
  $('#view-full').setAttribute('aria-pressed', String(!short));
  $('#view-short').setAttribute('aria-pressed', String(short));
}

function setView(v) {
  stopEditing();
  state.view = v;
  syncView();
  state.sections.forEach((_, i) => updateSection(i));
  refreshToolbar();
}
$('#view-full').addEventListener('click', () => setView('full'));
$('#view-short').addEventListener('click', () => setView('short'));

/* ---------- tabs and bottom bars ---------- */

function updateBars() {
  const lectureBar = state.tab === 'lecture' && state.video && state.video.chapters.length > 0;
  const notesBar = state.tab === 'notes' && state.sections.length > 0;
  $('#bar-lecture').hidden = !lectureBar;
  $('#bar-notes').hidden = !notesBar;
  document.body.classList.toggle('has-bar', Boolean(lectureBar || notesBar));
  $('#notes-dot').hidden = !(state.busy && state.tab !== 'notes');
}

function switchTab(name) {
  state.scroll[state.tab] = window.scrollY;
  state.tab = name;
  $('#tab-lecture').hidden = name !== 'lecture';
  $('#tab-notes').hidden = name !== 'notes';
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'));
  updateBars();
  window.scrollTo(0, state.scroll[name] || 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ---------- settings (a sheet that slides up) ---------- */

const dlg = $('#settings');

function refreshKeyState() {
  $('#key-dot').hidden = Boolean(store.get('key').trim());
}

function openSettings(message = '', info = false) {
  $('#set-key').value = store.get('key');
  $('#set-model').value = store.get('model');
  $('#set-model').placeholder = DEFAULT_MODEL;
  $('#settings-msg').classList.toggle('info', info);
  showMsg($('#settings-msg'), message);
  if (!dlg.open) dlg.showModal();
}

$('#open-settings').addEventListener('click', () => openSettings());
$('#settings-cancel').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
$('#settings-form').addEventListener('submit', () => {
  store.set('key', $('#set-key').value.trim());
  store.set('model', $('#set-model').value.trim());
  refreshKeyState();
});

$('#load-models').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const msg = $('#settings-msg');
  btn.disabled = true;
  msg.classList.remove('info');
  showMsg(msg, '');
  try {
    const { models } = await api('/api/models', { apiKey: $('#set-key').value.trim() });
    $('#model-list').innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join('');
    if (models.length) {
      msg.classList.add('info');
      showMsg(msg, `${models.length} models loaded. Tap the Model box to choose one.`);
    } else {
      showMsg(msg, 'No usable Gemini models were returned for this key.');
    }
  } catch (err) {
    showMsg(msg, err.message);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- step 1: get topics ---------- */

function setFetching(on) {
  $('#fetch-btn').disabled = on;
  $('#fetch-btn').textContent = on ? 'Reading the video…' : 'Get topics';
}

async function loadVideo(topicsText = '') {
  showMsg($('#msg'), '');
  setFetching(true);
  try {
    const v = await api('/api/video', { url: $('#url').value, topicsText, refresh: true });
    state.video = v;
    state.selected.clear();
    state.sections = [];
    state.view = 'full';
    syncView();
    renderSheetShell();
    renderVideo();
  } catch (err) {
    showMsg($('#msg'), err.message);
  } finally {
    setFetching(false);
  }
}

$('#url-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#paste-topics').value = '';
  loadVideo();
});

$('#paste-btn').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (text) $('#url').value = text;
  } catch {
    $('#url').focus();
    showMsg($('#msg'), 'Couldn’t read the clipboard. Press and hold in the box, then choose Paste.');
  }
});

$('#use-pasted').addEventListener('click', () => loadVideo($('#paste-topics').value));

$('#auto-topics').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (!getAuth().apiKey) return openSettings('Add your Gemini API key so it can read the captions.');
  btn.disabled = true;
  btn.textContent = 'Detecting…';
  showMsg($('#msg'), '');
  try {
    const r = await api('/api/auto-topics', { videoId: state.video.videoId, ...getAuth() });
    state.video.chapters = r.chapters;
    state.video.topicsSource = r.topicsSource;
    state.selected.clear();
    renderVideo();
  } catch (err) {
    showMsg($('#msg'), err.message);
    if (err.fatal) openSettings(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Detect topics with Gemini';
  }
});

const OPEN_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-3M9.5 2H14v4.5M14 2 7.5 8.5"/></svg>';

function renderVideo() {
  const v = state.video;
  $('#video').hidden = false;
  $('#lecture-empty').hidden = true;
  $('#thumb').src = `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
  $('#v-title').textContent = v.title;
  const bits = [v.author, v.duration ? fmtLen(v.duration) : ''].filter(Boolean).join(', ');
  const src = { description: 'Topics from the video description.', pasted: 'Topics from the timestamps you pasted.', gemini: 'Topics suggested by Gemini from the captions.' }[v.topicsSource] || '';
  $('#v-meta').textContent = [bits, src].filter(Boolean).join('. ');

  $('#no-captions').hidden = v.hasTranscript;
  if (!v.hasTranscript) {
    $('#cap-note').textContent = v.transcriptNote || 'No details were returned.';
    showMsg($('#transcript-msg'), '');
  }

  const noTopics = !v.chapters.length;
  $('#no-topics').hidden = !noTopics;
  $('#style-card').hidden = noTopics;
  $('.list-tools').hidden = noTopics;
  $('#topics').hidden = noTopics;

  const durations = v.chapters.map((c) => (c.end ?? v.duration) - c.start);
  const longest = Math.max(1, ...durations);
  $('#topics').innerHTML = v.chapters
    .map((c, i) => {
      const dur = Math.max(0, durations[i]);
      const width = Math.max(2, Math.round((dur / longest) * 100));
      const isBreak = /^\s*(break|lunch|tea break)\b/i.test(c.title);
      return `<li class="topic${isBreak ? ' is-break' : ''}" data-id="${c.id}">
        <label>
          <input type="checkbox" value="${c.id}">
          <span class="t-main">
            <span class="t-title">${esc(c.title)}</span>
            <span class="t-meta"><span>${fmt(c.start)}</span><span>${fmtLen(dur)}</span></span>
            <span class="t-bar"><i style="width:${width}%"></i></span>
          </span>
        </label>
        <button type="button" class="t-open" data-url="https://www.youtube.com/watch?v=${v.videoId}&t=${Math.floor(c.start)}s" aria-label="Watch “${esc(c.title)}” on YouTube">${OPEN_ICON}</button>
      </li>`;
    })
    .join('');
  $('#filter').value = '';
  updateSummary();
  updateBars();
}

$('#use-transcript').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  showMsg($('#transcript-msg'), '');
  try {
    const r = await api('/api/transcript', { videoId: state.video.videoId, text: $('#paste-transcript').value });
    state.video.hasTranscript = true;
    $('#no-captions').hidden = true;
    $('#paste-transcript').value = '';
    setStatus(`Transcript added (${r.lines} lines). Pick topics and make notes.`);
  } catch (err) {
    showMsg($('#transcript-msg'), err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#retry-captions').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Trying…';
  const keep = new Set(state.selected);
  await loadVideo();
  keep.forEach((id) => {
    const input = $(`#topics input[value="${id}"]`);
    if (!input) return;
    input.checked = true;
    input.closest('.topic').classList.add('is-on');
    state.selected.add(id);
  });
  updateSummary();
  btn.disabled = false;
  btn.textContent = 'Try downloading again';
});

/* ---------- step 2: choose topics ---------- */

$('#topics').addEventListener('change', (e) => {
  const input = e.target.closest('input[type="checkbox"]');
  if (!input) return;
  const id = Number(input.value);
  input.checked ? state.selected.add(id) : state.selected.delete(id);
  input.closest('.topic').classList.toggle('is-on', input.checked);
  updateSummary();
});

$('#topics').addEventListener('click', (e) => {
  const open = e.target.closest('.t-open');
  if (open) openExternal(open.dataset.url);
});

function setAll(on) {
  $('#topics').querySelectorAll('.topic:not([hidden])').forEach((li) => {
    const input = $('input', li);
    input.checked = on;
    li.classList.toggle('is-on', on);
    on ? state.selected.add(Number(input.value)) : state.selected.delete(Number(input.value));
  });
  updateSummary();
}
$('#sel-all').addEventListener('click', () => setAll(true));
$('#sel-none').addEventListener('click', () => {
  state.selected.clear();
  setAll(false);
});

$('#filter').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  $('#topics').querySelectorAll('.topic').forEach((li) => {
    li.hidden = q && !$('.t-title', li).textContent.toLowerCase().includes(q);
  });
});

const selectedChapters = () => (state.video?.chapters || []).filter((c) => state.selected.has(c.id));

function updateSummary() {
  const picks = selectedChapters();
  const total = picks.reduce((n, c) => n + Math.max(0, (c.end ?? state.video.duration) - c.start), 0);
  $('#sel-count').textContent = picks.length ? `${picks.length} topic${picks.length > 1 ? 's' : ''} selected` : 'No topics selected';
  $('#sel-time').textContent = total ? `${fmtLen(total)} of lecture` : 'Tick topics above';
  $('#make-btn').disabled = !picks.length || state.busy;
}

/* ---------- note style options ---------- */

const DETAIL_NAMES = { concise: 'Short', standard: 'Standard', detailed: 'Detailed' };
function updateStyleSummary() {
  const lang = $('#opt-language');
  $('#style-sum').textContent = [DETAIL_NAMES[$('#opt-detail').value], lang.options[lang.selectedIndex].text, $('#opt-diagrams').checked ? 'diagrams' : ''].filter(Boolean).join(', ');
}

[['detail', 'detail2'], ['language', 'language']].forEach(([id, key]) => {
  const el = $('#opt-' + id);
  el.value = store.get(key, el.value);
  el.addEventListener('change', () => { store.set(key, el.value); updateStyleSummary(); });
});
$('#opt-diagrams').checked = store.get('diagrams', '1') === '1';
$('#opt-diagrams').addEventListener('change', (e) => { store.set('diagrams', e.target.checked ? '1' : '0'); updateStyleSummary(); });
$('#opt-practice').checked = store.get('practice') === '1';
$('#opt-practice').addEventListener('change', (e) => store.set('practice', e.target.checked ? '1' : '0'));

/* ---------- step 3: make notes ---------- */

function setBusy(on) {
  state.busy = on;
  updateSummary();
  $('#fetch-btn').disabled = on;
  refreshToolbar();
  updateBars();
}

function setStatus(text, progress = null) {
  $('#status').textContent = text;
  const bar = $('#prog');
  bar.hidden = progress === null;
  if (progress !== null) bar.value = progress;
}

function refreshToolbar() {
  const done = state.sections.some((s) => s.status === 'done');
  const hasShort = state.sections.some((s) => s.shortMd);
  const ok = done && !state.busy;
  ['#btn-pdf', '#btn-copy', '#btn-short'].forEach((id) => ($(id).disabled = !ok));
  $('#view-short').disabled = !hasShort;
  $('#view-full').disabled = !done;
  if (!hasShort && state.view === 'short') {
    state.view = 'full';
    syncView();
    state.sections.forEach((_, i) => updateSection(i));
  }
}

function renderSheetShell() {
  const sheet = $('#sheet');
  const has = state.sections.length > 0;
  sheet.hidden = !has;
  $('#empty').hidden = has;
  if (!has) {
    sheet.innerHTML = '';
    setStatus('Notes will appear here.');
    refreshToolbar();
    updateBars();
    return;
  }
  sheet.innerHTML =
    `<header class="sheet-head"><h1>${esc(state.video.title)}</h1><p>${esc(state.sections.map((s) => s.title).join(', '))}</p></header>` +
    state.sections.map((s, i) => `<section class="n-sec" data-i="${i}" data-status="queued"></section>`).join('');
  state.sections.forEach((_, i) => updateSection(i));
  updateBars();
}

function updateSection(i) {
  const s = state.sections[i];
  const el = $(`.n-sec[data-i="${i}"]`);
  if (!el) return;
  el.dataset.status = s.status;

  let controls = '';
  if (s.status === 'done') {
    controls = `<button type="button" data-act="edit">Edit text</button><button type="button" data-act="retry" ${state.busy ? 'disabled' : ''}>Regenerate</button>`;
  } else if (s.status === 'editing') {
    controls = `<button type="button" data-act="done">Done editing</button>`;
  } else if ((s.status === 'error' || s.status === 'queued') && !state.busy) {
    controls = `<button type="button" data-act="retry">${s.status === 'error' ? 'Retry' : 'Make this topic'}</button>`;
  }

  let body = '';
  if (s.status === 'queued') body = `<p class="n-wait no-pdf">${state.busy ? 'Waiting for the earlier topics.' : 'Not started.'}</p>`;
  else if (s.status === 'working') body = `<p class="n-wait no-pdf"><span class="spin"></span> Reading the captions and writing notes…</p>`;
  else if (s.status === 'error') body = `<p class="n-err no-pdf" role="alert">${esc(s.error)}</p>`;
  else if (s.status === 'editing') body = `<textarea class="n-edit no-pdf" spellcheck="false">${esc(viewMd(s))}</textarea>`;
  else {
    let note = '';
    if (state.view === 'short' && !s.shortMd) {
      note = s.shortError
        ? `<p class="n-note no-pdf">Couldn’t shorten this topic (${esc(s.shortError)}). Showing the full notes. Tap Make shorter to try again.</p>`
        : `<p class="n-note no-pdf">Not shortened yet, so the full notes are shown. Tap Make shorter.</p>`;
    }
    body = `${note}<div class="md">${renderMd(viewMd(s))}</div>`;
  }

  el.innerHTML = `<div class="n-head"><h2>${esc(s.title)}</h2><span class="n-time">${fmt(s.start)} to ${s.end != null ? fmt(s.end) : 'end'}</span><span class="n-ctl no-pdf">${controls}</span></div>${body}`;
  if (s.status === 'done') pendingDiagrams = Promise.all([pendingDiagrams, drawMermaid(el)]);
}

async function runSection(i) {
  const s = state.sections[i];
  s.status = 'working';
  s.error = '';
  updateSection(i);
  try {
    const r = await api('/api/notes', {
      videoId: state.video.videoId,
      topic: { title: s.title, start: s.start, end: s.end },
      options: getOpts(),
      ...getAuth(),
    });
    s.md = r.markdown;
    s.shortMd = null;
    s.shortError = '';
    s.status = 'done';
    updateSection(i);
    return false;
  } catch (err) {
    s.status = 'error';
    s.error = err.message;
    updateSection(i);
    return Boolean(err.fatal);
  }
}

function finishRun(stoppedByFatal) {
  const done = state.sections.filter((s) => s.status === 'done').length;
  const failed = state.sections.filter((s) => s.status === 'error').length;
  setBusy(false);
  state.sections.forEach((_, i) => updateSection(i));
  setStatus(
    stoppedByFatal
      ? 'Stopped. Fix the problem shown below, then tap Retry.'
      : failed
        ? `${done} of ${state.sections.length} topics done. ${failed} failed: tap Retry on those.`
        : `Notes are ready: ${done} topic${done > 1 ? 's' : ''}. Check them, then save the PDF.`,
    null
  );
}

$('#make-btn').addEventListener('click', async () => {
  if (state.busy) return;
  if (!getAuth().apiKey) return openSettings('Add your Gemini API key to make notes.');
  const picks = selectedChapters();
  if (!picks.length) return;

  state.sections = picks.map((c) => ({ ...c, md: '', shortMd: null, shortError: '', status: 'queued', error: '' }));
  state.view = 'full';
  syncView();
  renderSheetShell();
  setBusy(true);
  switchTab('notes');

  let fatal = false;
  for (let i = 0; i < state.sections.length && !fatal; i++) {
    setStatus(`Writing notes ${i + 1} of ${state.sections.length}: ${state.sections[i].title}`, i / state.sections.length);
    fatal = await runSection(i);
  }
  if (fatal) {
    const failed = state.sections.find((s) => s.status === 'error');
    if (failed && /key|settings|model/i.test(failed.error)) openSettings(failed.error);
  }
  finishRun(fatal);
});

$('#sheet').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = Number(btn.closest('.n-sec').dataset.i);
  const s = state.sections[i];

  if (btn.dataset.act === 'edit') {
    s.status = 'editing';
    updateSection(i);
    refreshToolbar();
  } else if (btn.dataset.act === 'done') {
    const ta = $(`.n-sec[data-i="${i}"] .n-edit`);
    if (ta) { if (ta.value !== viewMd(s)) s.edited = true; setViewMd(s, ta.value); }
    s.status = 'done';
    updateSection(i);
    refreshToolbar();
  } else if (btn.dataset.act === 'retry') {
    if (state.busy) return;
    if (s.status === 'done' && s.edited && !confirm('Regenerating replaces your edits to this topic. Continue?')) return;
    s.edited = false;
    setBusy(true);
    setStatus(`Writing notes: ${s.title}`, null);
    const fatal = await runSection(i);
    if (fatal) openSettings(s.error);
    finishRun(fatal);
  }
});

function stopEditing() {
  state.sections.forEach((s, i) => {
    if (s.status === 'editing') {
      const ta = $(`.n-sec[data-i="${i}"] .n-edit`);
      if (ta) setViewMd(s, ta.value);
      s.status = 'done';
      updateSection(i);
    }
  });
}

/* ---------- make shorter ---------- */

$('#btn-short').addEventListener('click', async () => {
  if (state.busy) return;
  stopEditing();
  if (!getAuth().apiKey) return openSettings('Add your Gemini API key to shorten the notes.');

  const todo = state.sections.map((_, i) => i).filter((i) => state.sections[i].status === 'done' && !state.sections[i].shortMd);
  if (!todo.length) {
    setView('short');
    return;
  }

  setBusy(true);
  let failed = 0;
  let fatal = false;
  let n = 0;
  for (const i of todo) {
    const s = state.sections[i];
    setStatus(`Making notes shorter, ${++n} of ${todo.length}: ${s.title}`, (n - 1) / todo.length);
    s.shortError = '';
    try {
      const r = await api('/api/condense', { markdown: s.md, title: s.title, options: { language: getOpts().language }, ...getAuth() });
      s.shortMd = r.markdown;
    } catch (err) {
      s.shortError = err.message;
      failed++;
      fatal = Boolean(err.fatal);
    }
    if (fatal) break;
  }
  setBusy(false);

  const made = state.sections.filter((s) => s.shortMd).length;
  const total = state.sections.filter((s) => s.status === 'done').length;
  if (made) setView('short');
  else state.sections.forEach((_, i) => updateSection(i));
  setStatus(
    failed
      ? `${made} of ${total} topics shortened. ${failed} failed: tap Make shorter to try again.`
      : `Short notes are ready for ${made} topic${made > 1 ? 's' : ''}. Use Full or Short to switch.`,
    null
  );
  if (fatal) openSettings(state.sections.find((s) => s.shortError)?.shortError || '');
});

/* ---------- step 4: save PDF and copy ---------- */

$('#btn-pdf').addEventListener('click', async () => {
  stopEditing();
  const btn = $('#btn-pdf');
  const label = btn.textContent;
  btn.disabled = true;
  try {
    await pendingDiagrams;
    const name = `${slug(state.video.title)}${state.view === 'short' ? '-short' : ''}-notes`;
    const base64 = await buildPdfBase64($('#sheet'), (i, n) => { btn.textContent = `Page ${i} of ${n}…`; });
    btn.textContent = 'Opening…';
    await savePdf(base64, `${name}.pdf`, state.video.title);
    setStatus('PDF ready. Choose where to save or send it.');
  } catch (err) {
    if (!/cancel/i.test(String(err.message))) setStatus(`Couldn’t make the PDF: ${err.message}`);
  } finally {
    btn.textContent = label;
    refreshToolbar();
  }
});

$('#btn-copy').addEventListener('click', async () => {
  stopEditing();
  const md =
    `# ${state.video.title}\n\n` +
    state.sections.filter((s) => s.status === 'done').map((s) => `## ${s.title}\n\n${viewMd(s)}`).join('\n\n---\n\n');
  try {
    await navigator.clipboard.writeText(md);
    setStatus('Notes copied as Markdown.');
  } catch {
    try {
      await shareText(md, state.video.title);
    } catch {
      setStatus('Couldn’t copy the notes. Try again.');
    }
  }
});

/* ---------- start ---------- */

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-ext]');
  if (link) {
    e.preventDefault();
    openExternal(link.dataset.ext);
  }
});

if (Capacitor.isNativePlatform()) {
  // Android's back button: close the settings sheet, then go back to the Lecture tab, then leave.
  CapApp.addListener('backButton', () => {
    if (dlg.open) dlg.close();
    else if (state.tab === 'notes') switchTab('lecture');
    else CapApp.exitApp();
  });
}

(function init() {
  refreshKeyState();
  setZoom(Number(store.get('zoom', '1')) || 1);
  updateStyleSummary();
  updateSummary();
  updateBars();
  if (!store.get('key').trim() && !store.get('welcomed')) {
    store.set('welcomed', '1');
    setTimeout(() => openSettings('Welcome! Paste your free Gemini key to get started. You only do this once.', true), 500);
  }
})();
