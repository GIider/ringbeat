// Share links: the RTTTL string lives in the URL hash as #s=<base64url(UTF-8)>, optionally followed by &r=<rating>
// (the sender's measured difficulty, see customrating.js; the receiver treats it as unverified).
import { encodeRating, decodeRating } from './customrating.js';

export function encodeSong(str, rating) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r = rating ? encodeRating(rating) : '';
  return '#s=' + b64 + (r ? '&r=' + r : '');
}

// Returns { rtttl, rating } (rating null when absent or unusable), or null for anything missing/garbled. Never throws.
export function decodeShare(hash) {
  try {
    const m = /^#?s=([A-Za-z0-9_-]+)(?:&r=([^&]*))?(?:&.*)?$/.exec(String(hash || ''));
    if (!m) return null;
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return s.length ? { rtttl: s, rating: decodeRating(m[2]) } : null;
  } catch { return null; }
}

// Returns the RTTTL string, or null for anything missing/garbled. Never throws.
export function decodeSong(hash) {
  const d = decodeShare(hash);
  return d ? d.rtttl : null;
}
