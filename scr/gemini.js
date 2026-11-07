// Minimal Gemini REST client (no SDK needed). Runs on the phone.

import { http } from './http.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function geminiError(status, data) {
  const raw = data?.error?.message || `Gemini request failed (${status})`;
  let message = raw;
  if (status === 429) {
    message = `Gemini rate limit reached. Wait a minute and press Retry, or choose a lighter model in Gemini settings. (${raw})`;
  } else if (status === 404) {
    message = `Gemini can’t find this model. Open Gemini settings, press “Load models”, and pick one from the list. (${raw})`;
  }
  const err = new Error(message);
  err.status = status >= 400 && status < 600 ? status : 502;
  err.fatal = [401, 403, 404].includes(status) || /api key|API_KEY/i.test(raw);
  return err;
}

export async function generate({ apiKey, model, system, prompt, json = false, maxOutputTokens = 16384 }) {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: json ? 0.2 : 0.4,
      maxOutputTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  for (let attempt = 0; ; attempt++) {
    const res = await http(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey },
      json: body,
      timeout: 180000,
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || '')
        .join('')
        .trim();
      if (!text) {
        const why = data.promptFeedback?.blockReason || cand?.finishReason || 'no reason given';
        const err = new Error(`Gemini returned no text (${why}). Try again or choose another model.`);
        err.status = 502;
        throw err;
      }
      return { text, finishReason: cand?.finishReason };
    }

    if ([429, 500, 503].includes(res.status) && attempt < 3) {
      await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s
      continue;
    }
    throw geminiError(res.status, data);
  }
}

export async function listModels(apiKey) {
  const names = [];
  let pageToken = '';
  do {
    const url = new URL(`${BASE}/models`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await http(url.toString(), { headers: { 'x-goog-api-key': apiKey } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw geminiError(res.status, data);
    for (const m of data.models || []) {
      if ((m.supportedGenerationMethods || []).includes('generateContent')) {
        names.push(m.name.replace(/^models\//, ''));
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return names
    .filter((n) => /^gemini-/.test(n) && !/(image|tts|live|audio|embedding|robotics|computer-use|learnlm)/.test(n))
    .sort();
}
