// Offline test of the engine: YouTube and Gemini are replaced by fakes.
// Run with: npm test
import assert from 'node:assert/strict';
import { api } from '../src/engine.js';
import { planPages } from '../src/paginate.js';

const log = [];
const reply = (status, body) => ({ ok: status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  log.push({ url, body });

  if (url.includes('/youtubei/v1/player')) {
    return reply(200, {
      playabilityStatus: { status: 'OK' },
      videoDetails: {
        title: 'Electromagnetic Induction Full Chapter',
        author: 'Test Teacher',
        lengthSeconds: '300',
        shortDescription: 'Notes below\n[00:00](https://www.youtube.com/watch?v=abcdefghijk) - Introduction\n[01:00](https://www.youtube.com/watch?v=abcdefghijk&t=60s) - Magnetic Flux\n[03:00](https://www.youtube.com/watch?v=abcdefghijk&t=180s) - Self Inductance\nfollow me',
      },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=hi&kind=asr', languageCode: 'hi', kind: 'asr' },
      ] } },
    });
  }
  if (url.includes('/api/timedtext')) {
    const events = [];
    for (let s = 0; s < 300; s += 10) events.push({ tStartMs: s * 1000, segs: [{ utf8: `line at ${s} seconds about the lecture topic` }] });
    return reply(200, { events });
  }
  if (url.includes('generativelanguage.googleapis.com') && url.includes(':generateContent')) {
    if (opts.headers['x-goog-api-key'] === 'BAD') return reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    const sys = body.systemInstruction.parts[0].text;
    const isCondense = sys.startsWith('You turn study notes');
    const isTopics = sys.startsWith('You split a lecture');
    const text = isTopics
      ? '[{"start":0,"title":"Intro"},{"start":100,"title":"Flux"}]'
      : isCondense ? '### Short\n| Formula | Symbols | Use |\n|---|---|---|\n| $\\Phi = BA$ | flux | basic |'
      : '```markdown\n### Magnetic flux\n- $\\Phi = BA\\cos\\theta$\n```';
    return reply(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
  }
  return reply(404, 'not found');
};

let n = 0;
const ok = (name) => console.log(`  ok ${++n}  ${name}`);

// 1. link -> topics (from the description, markdown-link format) and captions found
const v = await api('/api/video', { url: 'https://youtu.be/abcdefghijk?si=x', refresh: true });
assert.equal(v.title, 'Electromagnetic Induction Full Chapter');
assert.equal(v.hasTranscript, true);
assert.deepEqual(v.chapters.map((c) => [c.title, c.start, c.end]), [['Introduction', 0, 60], ['Magnetic Flux', 60, 180], ['Self Inductance', 180, 300]]);
ok('video link gives title, 3 topics and auto-generated captions');

// 2. bad link
await assert.rejects(api('/api/video', { url: 'https://example.com' }), /doesn’t look like a YouTube link/);
ok('non-YouTube link is rejected clearly');

// 3. notes for ONE topic use only that topic's captions
log.length = 0;
const notes = await api('/api/notes', { videoId: v.videoId, apiKey: 'KEY', model: 'gemini-flash-latest', topic: { title: 'Magnetic Flux', start: 60, end: 180 }, options: { detail: 'concise', language: 'english', diagrams: false } });
assert.match(notes.markdown, /^### Magnetic flux/);
assert.ok(!notes.markdown.includes('```markdown'), 'outer fence removed');
const sent = log.find((l) => l.url.includes(':generateContent')).body.contents[0].parts[0].text;
assert.ok(sent.includes('line at 60 seconds') && sent.includes('line at 170 seconds'));
assert.ok(!sent.includes('line at 50 seconds') && !sent.includes('line at 180 seconds'), 'only this topic’s captions are sent');
ok('notes use only the selected topic’s captions; outer code fence stripped');

// 4. combination of topics = one call each
log.length = 0;
for (const t of v.chapters.slice(1)) await api('/api/notes', { videoId: v.videoId, apiKey: 'KEY', topic: t, options: {} });
assert.equal(log.filter((l) => l.url.includes(':generateContent')).length, 2);
ok('two selected topics make two separate Gemini calls');

// 5. make shorter
const short = await api('/api/condense', { apiKey: 'KEY', title: 'Magnetic Flux', markdown: notes.markdown + '\n\nmore explanation here', options: { language: 'hindi' } });
assert.match(short.markdown, /\| Formula \| Symbols \| Use \|/);
ok('make shorter returns a table with a formula sheet');

// 6. bad key is fatal, missing key is fatal
await assert.rejects(api('/api/notes', { videoId: v.videoId, apiKey: 'BAD', topic: v.chapters[1], options: {} }), (e) => e.fatal === true && /API key/.test(e.message));
await assert.rejects(api('/api/condense', { apiKey: '', markdown: 'x'.repeat(50) }), (e) => e.fatal === true);
ok('invalid or missing API key is reported as fatal');

// 7. detect topics with Gemini
const auto = await api('/api/auto-topics', { videoId: v.videoId, apiKey: 'KEY' });
assert.equal(auto.chapters.length, 2);
assert.equal(auto.chapters[1].end, 300);
ok('Gemini topic detection builds topics with end times');

// 8. pasted transcript replaces captions
const lines = Array.from({ length: 6 }, (_, i) => `${i}:00\ntext ${i}`).join('\n');
const t = await api('/api/transcript', { videoId: v.videoId, text: lines });
assert.equal(t.lines, 6);
await assert.rejects(api('/api/transcript', { videoId: v.videoId, text: 'no stamps' }), /timestamps/);
ok('pasted transcript is parsed; text without timestamps is rejected');

// 9. PDF page planner never cuts through a block
const pages = planPages([{ top: 0, bottom: 400 }, { top: 400, bottom: 900 }, { top: 900, bottom: 1300 }, { top: 1300, bottom: 1500 }], 1500, 1000);
assert.deepEqual(pages, [[0, 900], [900, 1500]]);
const tall = planPages([{ top: 100, bottom: 3000 }], 3000, 1000);
assert.equal(tall[0][1], 1000, 'a block taller than a page is cut at the page edge');
ok('PDF pages break between blocks, never through a paragraph or formula');

console.log(`\nAll ${n} checks passed.`);
