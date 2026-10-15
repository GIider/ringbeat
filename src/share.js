// Share links: the RTTTL string lives in the URL hash as #s=<base64url(UTF-8)>.

export function encodeSong(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return '#s=' + b64;
}

// Returns the RTTTL string, or null for anything missing/garbled. Never throws.
export function decodeSong(hash) {
  try {
    const m = /^#?s=([A-Za-z0-9_-]+)$/.exec(String(hash || ''));
    if (!m) return null;
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return s.length ? s : null;
  } catch { return null; }
}
