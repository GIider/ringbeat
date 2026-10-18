// Measures what the cloud API costs on the wire. Usage: npm run bench:net [-- --url <api> --runs 20 --boards 367 --file snapshot.json --offline --live]
//   offline  GET /boards payload formats: raw / gzip / brotli sizes, exact decompress, JSON.parse and expand times.
//   live     real requests to a running API (default http://localhost:8787, e.g. npm run dev:cloud; a deployed API
//            works too, read-only GETs): encoding, wire vs decoded bytes, exact decompress of the wire bytes, TTFB,
//            total time, and whether a conditional request (also with the edge's W/ ETag) gets a 304.
// Compare wire numbers from the deployed API: a local `wrangler dev` does not compress like Cloudflare's edge does.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { DECODERS, bodyOf, kb, median, ms, measureBody, percentile, synthBoards, timeIt, variants } from './lib/netbench.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt; };
const flag = name => args.includes('--' + name);
const RUNS = Math.max(3, +opt('runs', 20) || 20), BOARDS = +opt('boards', 367) || 367;
const URL_BASE = opt('url', 'http://localhost:8787').replace(/\/$/, '');
const onlyOffline = flag('offline'), onlyLive = flag('live');

// One GET without decoding: { status, headers, wire: Buffer, ttfb, total }.
function raw(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now(), chunks = [];
    let ttfb = 0;
    const req = (url.startsWith('https') ? https : http).get(url, { headers }, res => {
      ttfb = performance.now() - t0;
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, wire: Buffer.concat(chunks), ttfb, total: performance.now() - t0 }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
  });
}
const decode = r => { const f = DECODERS[r.headers['content-encoding']]; return f ? f(r.wire) : r.wire; };
const timing = r => String(r.headers['server-timing'] || '').split(',').map(s => s.trim()).filter(Boolean).join(' ') || '-';

function offline() {
  let boards;
  if (opt('file', '')) { const j = JSON.parse(readFileSync(opt('file'), 'utf8')); boards = j.boards || j; } else boards = synthBoards({ boards: BOARDS });
  const rows = Object.values(boards).reduce((n, r) => n + r.length, 0);
  console.log(`\nGET /boards formats: ${Object.keys(boards).length} boards, ${rows} rows ${opt('file', '') ? '(from ' + opt('file') + ')' : '(synthetic, seeded)'}`);
  console.table(variants(boards).map(v => measureBody(v, RUNS)));
}

async function live() {
  console.log(`\nLive: ${URL_BASE}  (${RUNS} runs each)`);
  const probe = await raw(URL_BASE + '/boards', { 'Accept-Encoding': 'gzip' }).catch(e => { console.log('  cannot reach the API: ' + e.message + ' (start it with npm run dev:cloud, or pass --url)'); return null; });
  if (!probe) return;
  const rows = [];
  for (const enc of ['identity', 'gzip', 'br']) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await raw(URL_BASE + '/boards', { 'Accept-Encoding': enc, 'Cache-Control': 'no-cache' }));
    const first = runs[0], got = first.headers['content-encoding'] || 'none';
    const decoded = decode(first).length;
    rows.push({
      asked: enc, got, status: first.status, wire: kb(first.wire.length), decoded: kb(decoded), ratio: (decoded / Math.max(1, first.wire.length)).toFixed(1) + 'x',
      'decompress': got === 'none' ? '-' : ms(timeIt(() => decode(first), RUNS)),
      'ttfb p50': ms(median(runs.map(r => r.ttfb))), 'total p50': ms(median(runs.map(r => r.total))), 'total p95': ms(percentile(runs.map(r => r.total), 95)),
      server: timing(first),
    });
    if (enc !== 'identity' && got === 'none') console.log(`  note: asked for ${enc} but the API answered uncompressed (a local wrangler dev, or no edge in front); wire sizes here are not what Cloudflare sends`);
  }
  console.table(rows);

  const etag = probe.headers.etag;
  console.log('Conditional requests (If-None-Match):');
  if (!etag) console.log('  no ETag on /boards');
  else {
    const cases = { 'as sent': etag, 'W/ copy': etag.startsWith('W/') ? etag.slice(2) : 'W/' + etag, 'wrong': '"0"' };
    const out = [];
    for (const [name, value] of Object.entries(cases)) {
      const r = await raw(URL_BASE + '/boards', { 'If-None-Match': value, 'Accept-Encoding': 'gzip' });
      out.push({ 'If-None-Match': name, value, status: r.status, wire: kb(r.wire.length), 'total': ms(r.total) });
    }
    console.table(out);
    if (out.find(o => o['If-None-Match'] === 'W/ copy').status !== 304) console.log('  -> the API does not accept a weak (W/) ETag. If the ETag you got is already W/ (Cloudflare\'s edge weakens them when it compresses), browsers never get a 304');
  }

  const first = Object.keys(JSON.parse(decode(probe)).boards)[0];
  const others = [['GET /board/:song', first && `/board/${encodeURIComponent(first)}`], ['GET /me/export (signed out)', '/me/export']];
  const rest = [];
  for (const [name, path] of others.filter(o => o[1])) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await raw(URL_BASE + path, { 'Accept-Encoding': 'gzip' }));
    const r = runs[0];
    rest.push({ request: name, status: r.status, got: r.headers['content-encoding'] || 'none', wire: kb(r.wire.length), decoded: kb(decode(r).length), 'total p50': ms(median(runs.map(x => x.total))), server: timing(r) });
  }
  console.table(rest);
}

if (!onlyLive) offline();
if (!onlyOffline) await live();
