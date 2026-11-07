// Turns a YouTube description (or pasted text) into a list of topics.
// Understands "00:00 Intro", "00:00 - Intro", "Intro 00:00", "[00:00](url) - Intro", "(1:02:03) Intro" ...

const TS = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/;
const NON_ALNUM = /[^\p{L}\p{N}]/gu;

export function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function parseChapters(text, duration = 0) {
  const found = [];

  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim() || raw.length > 400) continue;

    const line = raw
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [00:00](https://...)  ->  00:00
      .replace(/https?:\/\/\S+/g, ' ')
      .trim();

    const m = TS.exec(line);
    if (!m) continue;

    const hasHours = m[1] !== undefined;
    const h = hasHours ? +m[1] : 0;
    const mi = +m[2];
    const s = +m[3];
    if (s > 59 || (hasHours && mi > 59)) continue;

    const before = line.slice(0, m.index);
    const after = line.slice(m.index + m[0].length);

    // A timestamp in the middle of a sentence is not a chapter line.
    if (before.replace(NON_ALNUM, '').length > 3 && after.replace(NON_ALNUM, '').length > 3) continue;

    const title = `${before} ${after}`
      .replace(/[(\[{]\s*[)\]}]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–—−:|•·.,;)\]}>*#_~]+/, '')
      .replace(/[\s\-–—−:|•·.,;(\[{<*#_~]+$/, '')
      .trim();

    found.push({ start: h * 3600 + mi * 60 + s, title: title || `Part ${found.length + 1}` });
  }

  found.sort((a, b) => a.start - b.start);
  const uniq = found.filter((c, i) => i === 0 || c.start !== found[i - 1].start);
  if (uniq.length < 2) return [];

  return uniq.map((c, i) => ({
    id: i,
    title: c.title,
    start: c.start,
    end: i + 1 < uniq.length ? uniq[i + 1].start : duration > c.start ? duration : null,
  }));
}
