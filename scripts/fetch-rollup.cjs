#!/usr/bin/env node
/**
 * Fetch rollup 3.x from npm registry, SHA-512 verified, extract to tools/rollup/.
 *
 * No npm CLI invocation. No postinstall scripts. Idempotent (skip if version matches).
 *
 * Trust footprint: a single pure-JS tarball (rollup itself), pinned by SHA-512.
 * Rollup 3.x has zero required runtime dependencies (fsevents is optional and
 * macOS-only — we never load it). The build path is structurally simpler than
 * rollup 4.x, which uses Rust napi-rs binaries per platform.
 *
 * To bump rollup, update VERSION + INTEGRITY below from:
 *   curl -s https://registry.npmjs.org/rollup/<version> | jq -r '.dist.integrity'
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const os = require('os');

const VERSION = '3.30.0';
const INTEGRITY = 'sha512-kQvGasUgN+AlWGliFn2POSajRQEsULVYFGTvOZmK06d7vCD+YhZztt70kGk3qaeAXeWYL5eO7zx+rAubBc55eA==';

const TOOLS_DIR = path.join(__dirname, '..', 'tools', 'rollup');

const tarBin = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';

function fetchUrl(url, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
                return resolve(fetchUrl(res.headers.location, redirectsLeft - 1));
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function verifySha512(buf, integrity) {
    const expected = integrity.replace(/^sha512-/, '');
    const actual = crypto.createHash('sha512').update(buf).digest('base64');
    return actual === expected;
}

async function main() {
    const verFile = path.join(TOOLS_DIR, '.wf-pinned-version');

    if (fs.existsSync(verFile) && fs.readFileSync(verFile, 'utf8') === `${VERSION}\n${INTEGRITY}`) {
        console.log(`rollup ${VERSION} already installed at ${TOOLS_DIR}`);
        return;
    }

    const url = `https://registry.npmjs.org/rollup/-/rollup-${VERSION}.tgz`;
    console.log(`Fetching rollup@${VERSION}`);
    const buf = await fetchUrl(url);
    if (!verifySha512(buf, INTEGRITY)) {
        console.error(`SHA-512 mismatch for rollup@${VERSION}`);
        console.error(`Expected: ${INTEGRITY}`);
        console.error(`Got: sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`);
        process.exit(1);
    }
    console.log(`SHA-512 integrity verified.`);

    fs.rmSync(TOOLS_DIR, { recursive: true, force: true });
    fs.mkdirSync(TOOLS_DIR, { recursive: true });

    const tmpFile = path.join(os.tmpdir(), `rollup-${VERSION}-${process.pid}.tgz`);
    fs.writeFileSync(tmpFile, buf);
    try {
        execFileSync(tarBin, ['-xzf', tmpFile, '-C', TOOLS_DIR, '--strip-components=1'], { stdio: 'inherit' });
    } catch (e) {
        console.error(`tar failed: ${e.message}`);
        try { fs.unlinkSync(tmpFile); } catch {}
        process.exit(1);
    }
    try { fs.unlinkSync(tmpFile); } catch {}

    fs.writeFileSync(verFile, `${VERSION}\n${INTEGRITY}`);

    const pkgVer = require(path.join(TOOLS_DIR, 'package.json')).version;
    console.log(`\nrollup ${pkgVer} ready at ${TOOLS_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
