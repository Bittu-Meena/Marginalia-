// On the phone, requests go through Android's own network stack (CapacitorHttp), which is
// how the app can read YouTube captions and call Gemini without a server in between.
// In a normal browser it falls back to fetch (YouTube will block that, but it is handy for tests).

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export async function http(url, { method = 'GET', headers = {}, json = null, timeout = 120000 } = {}) {
  const h = { ...headers };
  if (json !== null) h['Content-Type'] = 'application/json';

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url: String(url),
      method,
      headers: h,
      data: json !== null ? json : undefined,
      responseType: 'text',
      connectTimeout: 20000,
      readTimeout: timeout,
    });
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => raw,
      json: async () => JSON.parse(raw),
    };
  }

  const r = await fetch(String(url), { method, headers: h, body: json !== null ? JSON.stringify(json) : undefined });
  return { ok: r.ok, status: r.status, text: () => r.text(), json: () => r.json() };
}
