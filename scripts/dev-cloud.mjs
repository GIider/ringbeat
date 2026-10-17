// One command for working on the cloud features locally: npm run dev:cloud [-- --fresh] [-- --no-seed]
// Prepares server/.dev.vars (GitHub-free dev login), migrates the local D1, seeds bot players when it has none, then
// runs the Worker (:8787) and the live-reload game server (:8000, pointed at that Worker) side by side.
import { existsSync, readFileSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), SERVER = ROOT + 'server/';
const args = process.argv.slice(2);
const sh = (cmd, a, opts = {}) => spawnSync(cmd, a, { cwd: SERVER, encoding: 'utf8', ...opts });

if (!existsSync(SERVER + 'node_modules')) { console.log('Installing server dependencies...'); sh('npm', ['install'], { stdio: 'inherit' }); }
if (args.includes('--fresh')) rmSync(SERVER + '.wrangler/state', { recursive: true, force: true });

if (!existsSync(SERVER + '.dev.vars')) {
  const lan = Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => `http://${a.address}:*`);
  writeFileSync(SERVER + '.dev.vars', [
    '# Local API only (git-ignored). Written by npm run dev:cloud.',
    'DEV_LOGIN=1',
    'GITHUB_CLIENT_ID=unused-locally',
    'GITHUB_CLIENT_SECRET=unused-locally',
    'ALLOWED_ORIGINS=' + ['http://localhost:*', 'http://127.0.0.1:*', ...lan].join(','),
    '',
  ].join('\n'));
  console.log('Wrote server/.dev.vars');
} else if (!/^DEV_LOGIN=1$/m.test(readFileSync(SERVER + '.dev.vars', 'utf8'))) {
  appendFileSync(SERVER + '.dev.vars', '\nDEV_LOGIN=1\n'); // keeps an existing OAuth App setup, adds the GitHub-free login
  console.log('Added DEV_LOGIN=1 to server/.dev.vars');
}

if (sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'ringbeat', '--local'], { stdio: 'inherit' }).status) process.exit(1);
if (!args.includes('--no-seed')) {
  const out = sh('npx', ['wrangler', 'd1', 'execute', 'ringbeat', '--local', '--json', '--command', "SELECT COUNT(*) AS n FROM users WHERE id LIKE 'bot-%'"]);
  let n = 0;
  try { n = JSON.parse(out.stdout)[0].results[0].n; } catch { /* treat as empty */ }
  if (n) console.log(`Local D1 already has ${n} bot players (npm run seed refreshes them).`);
  else if (spawnSync('node', ['scripts/seed-local.mjs'], { cwd: ROOT, stdio: 'inherit' }).status) process.exit(1);
}

const kids = [
  ['api ', spawn('npx', ['wrangler', 'dev', '--ip', '0.0.0.0', '--port', '8787'], { cwd: SERVER })],
  ['game', spawn('node', ['scripts/serve.mjs', '--dev', '--cloud'], { cwd: ROOT })],
];
for (const [tag, k] of kids) {
  for (const stream of [k.stdout, k.stderr]) stream.on('data', d => process.stdout.write(String(d).replace(/^(?=.)/gm, `[${tag}] `)));
  k.on('exit', () => { for (const [, o] of kids) o.kill(); process.exit(0); });
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const [, k] of kids) k.kill(); });
