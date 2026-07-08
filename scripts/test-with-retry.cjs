#!/usr/bin/env node
/**
 * Resilient test runner for high-core / loaded machines.
 *
 * Vitest browser mode occasionally aborts a whole run with
 *   "Browser connection was closed while running tests. Was the page closed unexpectedly?"
 * and ZERO test failures. This is a known upstream issue (vitest-dev/vitest #7981,
 * fix pending in #10300): under a long browser-mode run a Chromium renderer reaches
 * its memory high-water mark and the page is killed. It is transient and not caused
 * by your change; a clean re-run passes. It shows up most on machines with many CPU
 * cores, where vitest fans tests out across more concurrent pages.
 *
 * Plain `npm test` runs vitest directly. This wrapper (`npm run test:retry`) runs the
 * same command and, ONLY when it sees that exact crash signature, settles briefly to
 * let the OS reclaim memory and retries. It never retries a run that completed with
 * real test failures, so a genuine failure is reported immediately.
 *
 * Pass-through args work: `npm run test:retry -- tests/lists.test.js`.
 */
'use strict';

const { spawn } = require('child_process');

const MAX_RETRIES = 2;
const SETTLE_MS = 8000;
const ARGS = ['vitest', 'run', '--config', 'tests/vitest.browser.config.js', ...process.argv.slice(2)];

function isTransientCrash(output) {
  // A completed run with real failures is NOT transient: never retry those.
  if (/\b[1-9]\d* failed\b/.test(output) && !/Browser connection was closed/.test(output)) {
    return false;
  }
  return /Browser connection was closed while running tests/.test(output)
      || /page closed unexpectedly/i.test(output)
      || /Target (page, context or browser|closed)/i.test(output);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOnce() {
  return new Promise((resolve) => {
    // `npx` resolves the local devDependency vitest whether invoked via npm or directly.
    const child = spawn('npx', ARGS, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let output = '';
    const tee = (stream, chunk) => { const s = chunk.toString(); output += s; stream.write(s); };
    child.stdout.on('data', (c) => tee(process.stdout, c));
    child.stderr.on('data', (c) => tee(process.stderr, c));
    child.on('close', (code) => resolve({ code: code == null ? 1 : code, output }));
    child.on('error', (err) => { process.stderr.write(String(err) + '\n'); resolve({ code: 1, output }); });
  });
}

(async () => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { code, output } = await runOnce();
    if (code === 0) process.exit(0);
    if (attempt < MAX_RETRIES && isTransientCrash(output)) {
      console.log(
        `\n↻ Transient browser-page drop (known vitest browser-mode issue, ` +
        `vitest-dev/vitest #10300), not a test failure. Settling ${SETTLE_MS / 1000}s ` +
        `and retrying (${attempt + 1}/${MAX_RETRIES})...\n`
      );
      await sleep(SETTLE_MS);
      continue;
    }
    process.exit(code);
  }
})();
