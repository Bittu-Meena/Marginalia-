// Pure helpers for caption files and transcripts (no network, no Capacitor), so they can be tested in Node.
import { fmt } from './chapters.js';

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

export function parseTimedText(body) {
  const t = String(body || '').trim();
  if (!t) return [];

  if (t.startsWith('{')) {
    let j;
    try { j = JSON.parse(t); } catch { return []; }
    return (j.events || [])
      .filter((e) => e.segs)
      .map((e) => ({ start: (e.tStartMs || 0) / 1000, text: clean(e.segs.map((s) => s.utf8 || '').join('')) }))
      .filter((s) => s.text);
  }

  const out = [];
  // newer XML: <p t="12340" d="2000"><s>word</s> ...</p>
  for (const m of t.matchAll(/<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = clean(m[2].replace(/<[^>]+>/g, ''));
    if (text) out.push({ start: Number(m[1]) / 1000, text });
  }
  if (out.length) return out;
  // older XML: <text start="12.34" dur="2">words</text>
  for (const m of t.matchAll(/<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = clean(m[2].replace(/<[^>]+>/g, ''));
    if (text) out.push({ start: Number(m[1]), text });
  }
  return out;
}

// Parses a transcript copied from YouTube's "Show transcript" panel.
export function parseTranscriptText(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const toSec = (ts) => ts.split(':').reduce((n, p) => n * 60 + Number(p), 0);
  const ONLY = /^(\d{1,2}(?::\d{2}){1,2})$/;
  const SAME = /^(\d{1,2}(?::\d{2}){1,2})\s+(.+)$/;

  const stampOnly = lines.filter((l) => ONLY.test(l)).length;
  const segs = [];

  if (stampOnly >= 5) {
    // "0:05" on its own line, text on the following line(s). Text before the first stamp is ignored.
    let cur = null;
    for (const l of lines) {
      const m = l.match(ONLY);
      if (m) {
        cur = { start: toSec(m[1]), text: '' };
        segs.push(cur);
      } else if (cur) {
        cur.text += ` ${l}`;
      }
    }
  } else {
    for (const l of lines) {
      const m = l.match(SAME);
      if (m) segs.push({ start: toSec(m[1]), text: m[2] });
    }
  }
  return segs.map((s) => ({ start: s.start, text: clean(s.text) })).filter((s) => s.text);
}


// Prefer uploaded captions, then auto-generated; prefer Hindi/English within each.
export function pickTrack(tracks) {
  const score = (t) => (t.kind === 'asr' ? 0 : 10) + (/^(en|hi)/.test(t.languageCode || '') ? 5 : 0);
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}


// Captions between start and end (seconds), with a [m:ss] marker about once a minute.
export function sliceTranscript(segments, start, end) {
  const limit = end ?? Infinity;
  let out = '';
  let mark = -Infinity;
  for (const s of segments) {
    if (s.start < start || s.start >= limit) continue;
    if (s.start - mark >= 60) {
      out += `\n[${fmt(s.start)}] `;
      mark = s.start;
    }
    out += s.text.replace(/\[(?:music|applause|laughter|संगीत)\]/gi, '').replace(/\s+/g, ' ') + ' ';
  }
  return out.trim();
}

// One short line per minute, used to let Gemini suggest topics when a video has none.
export function condenseTranscript(segments) {
  const buckets = new Map();
  for (const s of segments) {
    const b = Math.floor(s.start / 60);
    const cur = buckets.get(b) || '';
    if (cur.length < 350) buckets.set(b, `${cur} ${s.text}`.trim().slice(0, 350));
  }
  return [...buckets].map(([b, t]) => `[${fmt(b * 60)}] ${t}`).join('\n');
}
