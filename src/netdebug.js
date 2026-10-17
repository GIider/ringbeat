// The `?dev` request log: every cloud request (why it went out, what it carried, sizes, status, time) and every sync
// held back, as a corner panel, with the full bodies in the console. Plugged into cloud.js as its `debug` callback;
// only created in dev mode (docs/DEVELOPMENT.md › Debug URLs and hooks).

export const size = n => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

// What the browser says about a finished fetch (Resource Timing): { wire, transfer, decoded, source }. `wire` is the body
// as it crossed the network (compressed), `decoded` after decompression; `source` is '304' when the cache revalidated
// and sent no body, 'cache' when it answered without asking. {} when the browser has no entry for the url (or no
// Timing-Allow-Origin lets it show sizes).
export function wireOf(url, perf = globalThis.performance) {
  if (!url || !perf || !perf.getEntriesByName) return {};
  const t = perf.getEntriesByName(url, 'resource').at(-1);
  if (!t || !(t.encodedBodySize || t.transferSize || t.decodedBodySize)) return {}; // no entry, or sizes hidden cross-origin
  const wire = t.encodedBodySize, transfer = t.transferSize, decoded = t.decodedBodySize;
  // A revalidated entry reports the cached body's sizes but transferred only headers.
  return { wire, transfer, decoded, source: transfer === 0 && decoded > 0 ? 'cache' : transfer > 0 && transfer < wire ? '304' : '' };
}

// Rough time to decompress `text` as `encoding` (gzip / deflate / br): compresses it here, then times the decompression.
// The browser decompresses inside the network stack, so the real figure is not observable from the page; this is the
// same work on the same text, shown with a "~". -> ms, or null when this browser cannot do that encoding.
export async function estimateUnzip(text, encoding, { CS = globalThis.CompressionStream, DS = globalThis.DecompressionStream, tick = () => performance.now() } = {}) {
  const format = { gzip: 'gzip', 'x-gzip': 'gzip', deflate: 'deflate', br: 'brotli' }[encoding];
  if (!format || !CS || !DS) return null;
  const pipe = async (data, Stream) => new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new Stream(format))).arrayBuffer());
  try {
    const packed = await pipe(new TextEncoder().encode(text), CS);
    const t0 = tick();
    await pipe(packed, DS);
    return tick() - t0;
  } catch { return null; } // e.g. no brotli streams
}

const ms = n => (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ms';

// What a request carried and got back, in a few words. `e`: one cloud.js debug entry.
export function describe(e) {
  const b = e.body || {}, r = e.response || {}, sent = [], got = [];
  if (b.shared) sent.push('shared');
  else if ('sharedRev' in b) sent.push('rev ' + b.sharedRev);
  if (b.device) sent.push('device');
  if (Array.isArray(b.runs)) {
    const replays = b.runs.reduce((n, x) => n + (x.replay ? x.replay.length : 0), 0);
    sent.push(b.runs.length + (b.runs.length === 1 ? ' run' : ' runs') + (replays ? ` (replays ${size(replays)})` : ''));
  }
  if ('devicesSince' in b) sent.push('pull');
  if (r.shared) got.push(r.shared.doc ? 'shared rev ' + r.shared.rev : 'rev ' + r.shared.rev);
  if (r.devices) got.push(Object.keys(r.devices).length + '/' + (r.deviceIds || []).length + ' slots');
  if (r.runs) got.push(r.runs.map(v => (v.verified === 1 ? 'ranked' : v.verified === -1 ? 'invalid' : 'pending')).join(' '));
  if (r.ranks) for (const [k, v] of Object.entries(r.ranks)) got.push(`${k} #${v.rank}/${v.total}`);
  if (e.why === 'admin') {
    if ('pending' in r) got.push(`pending ${r.pending}, unverifiable ${r.stuck}`);
    if ('verified' in r) got.push(`verified ${r.verified}`);
    if ('removed' in r) got.push(`removed ${r.removed}`);
  }
  if (r.boards) got.push(Object.keys(r.boards).length + ' boards');
  return [sent.join(', '), got.join(', ')].filter(Boolean).join(' → ');
}

// One line of the panel. -> string
export function line(e, time = new Date()) {
  const t = time.toTimeString().slice(0, 8), why = (e.why || '').padEnd(10);
  if (e.skipped && !e.method) return `${t} ${why} held: ${e.skipped}`;
  const head = `${t} ${why} ${e.method} ${e.path}`;
  if (e.skipped) return `${head} skipped: ${e.skipped}`;
  const down = e.received == null ? '' : e.source === '304' ? ' ↓0 B (304)'
    : e.wire != null ? ` ↓${size(e.wire)} wire${e.encoding ? ' ' + e.encoding : ''} / ${size(e.decoded || e.received)}${e.source === 'cache' ? ' (cache)' : ''}`
    : ' ↓' + size(e.received);
  const result = e.error ? e.error : `${e.status} ↑${size(e.sent)}${down}`;
  const times = e.read == null ? '' : ` · read ${ms(e.read)}${e.unzip != null ? ` · unzip ~${ms(e.unzip)}` : ''} · parse ${ms(e.parse)}`;
  const what = describe(e);
  return `${head} ${result} ${e.ms} ms${e.keepalive ? ' keepalive' : ''}${times}${what ? ' · ' + what : ''}`;
}

export function createNetDebug({ max = 10, doc = globalThis.document, out = globalThis.console, perf = globalThis.performance, unzip = estimateUnzip } = {}) {
  const totals = { requests: 0, up: 0, down: 0, wire: 0 }, lines = [];
  let el = null;
  function render() {
    if (!doc) return;
    if (!el) {
      el = doc.createElement('pre');
      el.className = 'net-debug';
      doc.body.appendChild(el);
    }
    el.textContent = `cloud: ${totals.requests} requests · ↑${size(totals.up)} ↓${size(totals.wire)} wire / ${size(totals.down)}\n` + lines.map(l => l.text).join('\n');
  }
  function log(e) {
    if (e.method && !e.skipped && e.url) Object.assign(e, wireOf(e.url, perf));
    const text = line(e);
    if (e.method && !e.skipped) {
      totals.requests++;
      totals.up += e.sent || 0;
      totals.down += e.received || 0;
      totals.wire += e.source === '304' ? 0 : e.wire != null ? e.wire : e.received || 0;
      out.groupCollapsed('[cloud] ' + text);
      if (e.body) out.log('sent', e.body);
      if (e.response) out.log('received', e.response);
      out.groupEnd();
    } else out.debug('[cloud] ' + text);
    const entry = { text };
    lines.push(entry);
    if (lines.length > max) lines.shift();
    render();
    if (e.encoding && e.wire && e.response) {
      Promise.resolve(unzip(JSON.stringify(e.response), e.encoding)).then(t => {
        if (t == null) return;
        e.unzip = t;
        entry.text = line(e);
        render();
      });
    }
  }
  log.totals = () => ({ ...totals });
  return log;
}
