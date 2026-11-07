// The "server" of the Android app. It answers the same requests the desktop version sent to
// its Node server, but everything runs on the phone: the page calls api(path, body).

import { parseChapters } from './chapters.js';
import { extractVideoId, loadVideo, setManualTranscript } from './youtube.js';
import { parseTranscriptText, sliceTranscript, condenseTranscript } from './captions.js';
import { generate, listModels } from './gemini.js';
import { notesSystem, notesPrompt, condenseSystem, condensePrompt, TOPICS_SYSTEM, topicsPrompt } from './prompts.js';

export const DEFAULT_MODEL = 'gemini-flash-latest';

const bad = (message, fatal = false) => Object.assign(new Error(message), { fatal });

function auth(body) {
  const apiKey = String(body.apiKey || '').trim();
  if (!apiKey) throw bad('Add your Gemini API key in settings first.', true);
  return { apiKey, model: String(body.model || DEFAULT_MODEL).trim() };
}

// Gemini sometimes wraps the whole answer in a ```markdown fence. Remove only that outer fence.
const stripOuterFence = (t) => {
  const m = String(t).match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```\s*$/i);
  return m ? m[1] : String(t);
};

const routes = {
  async '/api/video'(b) {
    const id = extractVideoId(b.url);
    if (!id) throw bad('That doesn’t look like a YouTube link. Paste something like https://youtu.be/VIDEO_ID');

    const video = await loadVideo(id, { refresh: Boolean(b.refresh) });
    const pasted = String(b.topicsText || '').trim();
    const chapters = parseChapters(pasted || video.description, video.duration);
    if (pasted && !chapters.length) {
      throw bad('Couldn’t find at least two timestamps in that text. Use one topic per line, like “05:32 Electromagnetic Induction”.');
    }
    return {
      videoId: id,
      title: video.title,
      author: video.author,
      duration: video.duration,
      hasTranscript: video.segments.length > 0,
      transcriptNote: video.segments.length ? '' : video.problems.join(' | '),
      topicsSource: pasted ? 'pasted' : chapters.length ? 'description' : 'none',
      chapters,
    };
  },

  async '/api/transcript'(b) {
    const id = extractVideoId(b.videoId);
    if (!id) throw bad('Missing video.');
    const segments = parseTranscriptText(b.text);
    if (segments.length < 5) {
      throw bad('Couldn’t find timestamps in that text. Copy the transcript from YouTube’s “Show transcript” panel, with its times (like 0:05), and paste it again.');
    }
    await setManualTranscript(id, segments);
    return { ok: true, lines: segments.length };
  },

  async '/api/auto-topics'(b) {
    const id = extractVideoId(b.videoId);
    if (!id) throw bad('Missing video.');
    const { apiKey, model } = auth(b);
    const video = await loadVideo(id);
    if (!video.segments.length) throw bad('This video has no captions, so topics can’t be detected.');

    const { text } = await generate({
      apiKey,
      model,
      system: TOPICS_SYSTEM,
      prompt: topicsPrompt({ videoTitle: video.title, condensed: condenseTranscript(video.segments) }),
      json: true,
      maxOutputTokens: 4096,
    });

    let list;
    try {
      list = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw bad('Gemini’s topic list wasn’t readable. Try again.');
    }
    const rows = (Array.isArray(list) ? list : [])
      .filter((t) => t && Number.isFinite(Number(t.start)) && t.title)
      .map((t) => ({ start: Math.max(0, Math.floor(Number(t.start))), title: String(t.title).trim() }))
      .sort((a, c) => a.start - c.start)
      .filter((c, i, a) => i === 0 || c.start !== a[i - 1].start);
    if (rows.length < 2) throw bad('Gemini didn’t find separate topics in this video.');

    const chapters = rows.map((c, i) => ({
      id: i,
      title: c.title,
      start: c.start,
      end: i + 1 < rows.length ? rows[i + 1].start : video.duration > c.start ? video.duration : null,
    }));
    return { chapters, topicsSource: 'gemini' };
  },

  async '/api/models'(b) {
    const { apiKey } = auth(b);
    return { models: await listModels(apiKey) };
  },

  async '/api/notes'(b) {
    const id = extractVideoId(b.videoId);
    if (!id) throw bad('Missing video.');
    const { apiKey, model } = auth(b);
    const t = b.topic || {};
    const topic = {
      title: String(t.title || 'Topic').slice(0, 200),
      start: Math.max(0, Number(t.start) || 0),
      end: t.end == null ? null : Number(t.end),
    };
    const o = b.options || {};

    const video = await loadVideo(id);
    if (!video.segments.length) throw bad('This video has no captions, so notes can’t be made from it.');
    const transcript = sliceTranscript(video.segments, topic.start, topic.end);
    if (transcript.length < 40) throw bad(`No captions found for “${topic.title}”. It may be a silent part or a break.`);

    const { text, finishReason } = await generate({
      apiKey,
      model,
      system: notesSystem({ detail: o.detail, language: o.language, practice: Boolean(o.practice), diagrams: Boolean(o.diagrams) }),
      prompt: notesPrompt({ videoTitle: video.title, topic, transcript }),
    });
    let markdown = stripOuterFence(text);
    if (finishReason === 'MAX_TOKENS') {
      markdown += '\n\n> **Note:** these notes were cut off because the topic is very long. Try “Short” detail or Regenerate.';
    }
    return { markdown };
  },

  async '/api/condense'(b) {
    const { apiKey, model } = auth(b);
    const markdown = String(b.markdown || '').slice(0, 200000);
    if (markdown.trim().length < 20) throw bad('There are no notes to shorten yet.');
    const title = String(b.title || 'Topic').slice(0, 200);
    const language = String(b.options?.language || 'english');

    const { text, finishReason } = await generate({
      apiKey,
      model,
      system: condenseSystem({ language }),
      prompt: condensePrompt({ title, markdown }),
    });
    let out = stripOuterFence(text);
    if (finishReason === 'MAX_TOKENS') out += '\n\n> **Note:** this short version was cut off. Press Make shorter again.';
    return { markdown: out };
  },
};

export async function api(path, body) {
  const route = routes[path];
  if (!route) throw bad(`Unknown request: ${path}`);
  return route(body || {});
}
