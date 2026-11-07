// Finds a video's title, description, length and captions (auto-generated ones included).
// It runs on the phone and tries the YouTube Android app route, then the iOS app route,
// then the plain watch page. None of these is an official API.

import { http } from './http.js';
import { parseTimedText, pickTrack } from './captions.js';

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 60 * 60 * 1000;
const RETRY_AFTER_EMPTY = 20 * 1000;
const cache = new Map();

export function extractVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      id = u.searchParams.get('v');
      if (!id) id = (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/) || [])[1];
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function fetchTrack(track, ua) {
  const base = new URL(track.baseUrl);
  for (const format of ['json3', null]) {
    const u = new URL(base);
    if (format) u.searchParams.set('fmt', format);
    else u.searchParams.delete('fmt');
    const r = await http(u.toString(), { headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' } });
    const segs = parseTimedText(await r.text());
    if (segs.length) return segs;
  }
  return [];
}

const CLIENTS = {
  android: {
    label: 'Android app route',
    headerId: '3',
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, osName: 'Android', osVersion: '14' },
  },
  ios: {
    label: 'iOS app route',
    headerId: '5',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    client: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
  },
};

function metaFrom(pr) {
  const vd = pr.videoDetails || {};
  return {
    title: vd.title || '',
    author: vd.author || '',
    duration: Number(vd.lengthSeconds) || 0,
    description: vd.shortDescription || '',
  };
}

async function viaPlayer(videoId, c) {
  const res = await http('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'User-Agent': c.ua,
      'X-YouTube-Client-Name': c.headerId,
      'X-YouTube-Client-Version': c.client.clientVersion,
    },
    json: {
      context: { client: { ...c.client, hl: 'en', gl: 'US', userAgent: c.ua } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
  });
  const pr = await res.json();
  const status = pr.playabilityStatus?.status;
  if (status && status !== 'OK') throw new Error(`${status}${pr.playabilityStatus?.reason ? `: ${pr.playabilityStatus.reason}` : ''}`);

  const meta = metaFrom(pr);
  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return { meta, segments: null, note: 'YouTube offered no caption tracks' };

  const track = pickTrack(tracks);
  const segments = await fetchTrack(track, c.ua);
  return { meta, segments, note: segments.length ? '' : `caption file (${track.languageCode}${track.kind === 'asr' ? ', auto' : ''}) was empty` };
}

async function viaWatchPage(videoId) {
  const res = await http(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { 'User-Agent': WEB_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
  });
  const html = await res.text();
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
  if (!m) throw new Error('could not read the YouTube page');
  const pr = JSON.parse(m[1]);
  const meta = metaFrom(pr);
  const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return { meta, segments: null, note: 'YouTube offered no caption tracks' };
  const segments = await fetchTrack(pickTrack(tracks), WEB_UA);
  return { meta, segments, note: segments.length ? '' : 'caption file was empty' };
}

export async function loadVideo(videoId, { refresh = false } = {}) {
  const hit = cache.get(videoId);
  if (hit && (hit.manual || (!refresh && Date.now() < hit.expires))) return hit;

  let meta = null;
  let segments = null;
  const problems = [];

  const routes = [
    [CLIENTS.android.label, () => viaPlayer(videoId, CLIENTS.android)],
    [CLIENTS.ios.label, () => viaPlayer(videoId, CLIENTS.ios)],
    ['watch page', () => viaWatchPage(videoId)],
  ];

  for (const [name, run] of routes) {
    if (meta?.title && meta?.description && segments?.length) break;
    try {
      const r = await run();
      if (!meta?.title) meta = r.meta;
      else {
        if (!meta.description) meta.description = r.meta.description;
        if (!meta.duration) meta.duration = r.meta.duration;
      }
      if (!segments?.length && r.segments?.length) segments = r.segments;
      if (r.note) problems.push(`${name}: ${r.note}`);
    } catch (e) {
      problems.push(`${name}: ${e.message}`);
    }
  }

  if (!meta?.title) {
    throw new Error(`Couldn’t load this video. Check that it is public, the link is right, and you are online. (${problems.join(' | ') || 'no details'})`);
  }

  const video = {
    id: videoId,
    ...meta,
    segments: segments || [],
    problems,
    manual: false,
    expires: Date.now() + (segments?.length ? TTL : RETRY_AFTER_EMPTY),
  };
  cache.set(videoId, video);
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return video;
}

// Used when the person pastes a transcript copied from YouTube.
export async function setManualTranscript(videoId, segments) {
  const video = await loadVideo(videoId);
  video.segments = segments;
  video.problems = [];
  video.manual = true;
  return video;
}
