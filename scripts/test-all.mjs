// `npm test`: the unit tests, the UI smoke test and the cut-off text audit run side by side (they are independent; the
// two browser stages each start their own server on a random port). Each stage's output is printed when it finishes.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const units = readdirSync(new URL('../tests/', import.meta.url)).filter(f => f.endsWith('.test.mjs')).map(f => 'tests/' + f);
const stages = [
  ['unit tests', ['--test', '--test-reporter=./scripts/lib/quiet-reporter.mjs', ...units]],
  ['smoke', ['scripts/smoke.mjs']],
  ['overflow audit', ['scripts/overflow-audit.mjs']],
];

const t0 = Date.now();
const results = await Promise.all(stages.map(([name, args]) => new Promise(resolve => {
  const start = Date.now();
  let out = '';
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => {
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n=== ${name}: ${code === 0 ? 'ok' : 'FAILED'} (${secs}s) ===\n${out.trimEnd()}`);
    resolve(code === 0);
  });
})));
console.log(`\n${results.filter(Boolean).length}/${stages.length} stages passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exitCode = results.every(Boolean) ? 0 : 1;
