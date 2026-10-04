// Same-site API calls in the app. The web app calls its Netlify functions with
// relative URLs (fetch('/api/…'), fetch('/.netlify/functions/…')). Inside the
// app those resolve to the app's own capacitor:// / https://localhost origin,
// where nothing answers. Point them at the public site instead, and send them
// over native HTTP (CapacitorHttp), which isn't subject to browser CORS — so
// the functions need no app-specific headers.

import { CapacitorHttp } from '@capacitor/core';
import { publicOrigin } from './platform';

const SITE_API = /^\/(api|\.netlify\/functions)\//;

function toHeaderObject(h) {
  const out = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => { out[k] = v; });
  return out;
}

async function nativeFetch(url, init = {}) {
  const headers = toHeaderObject(init.headers);
  let data = init.body;
  const json = /json/i.test(headers['content-type'] || '');
  if (typeof data === 'string' && json) {
    try { data = JSON.parse(data); } catch { /* send as-is */ }
  }
  const res = await CapacitorHttp.request({
    url,
    method: (init.method || 'GET').toUpperCase(),
    headers,
    data,
    responseType: 'text',
  });
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? null);
  return new Response(body, { status: res.status, headers: res.headers });
}

export function installFetchShim() {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url;
    if (typeof raw === 'string' && SITE_API.test(raw)) {
      // Request objects (rare here) would need their body read first; keep to
      // the string-URL calls Cargo actually makes.
      if (typeof input === 'string') return nativeFetch(`${publicOrigin()}${raw}`, init);
    }
    return origFetch(input, init);
  };
}
