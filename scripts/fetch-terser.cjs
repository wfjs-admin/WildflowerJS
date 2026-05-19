#!/usr/bin/env node
/**
 * Fetch terser + minimal dep tree from npm registry, SHA-512 verified.
 *
 * No npm CLI invocation. No postinstall scripts. Direct tarball fetch only.
 *
 * Layout: tools/terser/node_modules/<pkg>/  (Node's resolver will find them
 * when terser does require('acorn') etc.)
 *
 * Trust footprint: 2 pure-JS packages (terser + acorn), zero-postinstall,
 * pinned by SHA-512. To bump versions, update VERSIONS+INTEGRITY here and
 * re-fetch.
 *
 * Why so few deps: terser's only runtime imports are (1) acorn for parsing
 * and (2) @jridgewell/source-map for source-map output. We never enable
 * source maps in the WildflowerJS build, so we patch out the single
 * @jridgewell import in terser/lib/sourcemap.js with a stub function that
 * throws if anyone tries to use it. That single patch eliminates the
 * @jridgewell tree (5 transitive packages) entirely. See PATCH_SOURCEMAP
 * below for the replacement.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const os = require('os');

// Pinned versions + SHA-512 integrity (fetched from npm registry on 2026-04-26).
// terser 5.46.2's only mandatory runtime imports are acorn (parsing) and
// @jridgewell/source-map (source-map generation). We never request source
// maps, so we replace lib/sourcemap.js with a stub (PATCH_SOURCEMAP below)
// and don't fetch any of the @jridgewell tarballs. See file header for
// rationale.
const PACKAGES = [
    { name: 'terser', version: '5.46.2',  integrity: 'sha512-uxfo9fPcSgLDYob/w1FuL0c99MWiJDnv+5qXSQc5+Ki5NjVNsYi66INnMFBjf6uFz6OnX12piJQPF4IpjJTNTw==' },
    { name: 'acorn',  version: '8.16.0',  integrity: 'sha512-UVJyE9MttOsBQIDKw1skb9nAwQuR5wuGD3+82K6JgJlm/Y+KI92oNsMNGZCYdDsVtRHSak0pcV5Dno5+4jh9sw==' },
];

// Replacement for terser/lib/sourcemap.js. The real file's only function is
// to import @jridgewell/source-map and re-export a SourceMap helper used
// inside terser/lib/minify.js — but ONLY when options.sourceMap is set.
// Since our build never sets that option, the real implementation is dead
// weight pulling in 5 transitive npm packages. We replace it with this stub
// that throws if anyone DOES try to enable source maps, so a future config
// drift fails loudly instead of silently producing broken maps.
const PATCH_SOURCEMAP = `// Replaced at fetch time by scripts/fetch-terser.cjs.
// Original file imported @jridgewell/source-map and provided a SourceMap()
// generator used only when terser.minify({ sourceMap: ... }) is called.
// This stub avoids pulling in the @jridgewell tree (5 packages); enabling
// source maps in this vendored terser is intentionally not supported.
export function SourceMap() {
    throw new Error("Source maps are disabled in this vendored terser build. " +
        "Re-enable by restoring lib/sourcemap.js from the upstream tarball " +
        "and adding the @jridgewell/* packages back to fetch-terser.cjs.");
}
`;

const TOOLS_DIR = path.join(__dirname, '..', 'tools', 'terser');
const NODE_MODULES = path.join(TOOLS_DIR, 'node_modules');

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

function tarballUrl(name, version) {
    // Scoped package URL: https://registry.npmjs.org/@scope/name/-/name-version.tgz
    const lastSegment = name.split('/').pop();
    return `https://registry.npmjs.org/${name}/-/${lastSegment}-${version}.tgz`;
}

async function fetchAndExtract(p) {
    const outDir = path.join(NODE_MODULES, p.name);
    const verFile = path.join(outDir, '.wf-pinned-version');

    // Idempotent: skip if already at the pinned version.
    if (fs.existsSync(verFile) && fs.readFileSync(verFile, 'utf8') === `${p.version}\n${p.integrity}`) {
        console.log(`${p.name}@${p.version} already installed`);
        return;
    }

    const url = tarballUrl(p.name, p.version);
    console.log(`Fetching ${p.name}@${p.version}`);
    const buf = await fetchUrl(url);
    if (!verifySha512(buf, p.integrity)) {
        console.error(`SHA-512 mismatch for ${p.name}@${p.version}`);
        console.error(`Expected: ${p.integrity}`);
        console.error(`Got: sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`);
        process.exit(1);
    }

    // Wipe any prior install, recreate.
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const tmpFile = path.join(os.tmpdir(), `${p.name.replace(/[\/@]/g, '_')}-${p.version}-${process.pid}.tgz`);
    fs.writeFileSync(tmpFile, buf);
    try {
        execFileSync(tarBin, ['-xzf', tmpFile, '-C', outDir, '--strip-components=1'], { stdio: 'inherit' });
    } catch (e) {
        console.error(`tar failed for ${p.name}: ${e.message}`);
        try { fs.unlinkSync(tmpFile); } catch {}
        process.exit(1);
    }
    try { fs.unlinkSync(tmpFile); } catch {}

    fs.writeFileSync(verFile, `${p.version}\n${p.integrity}`);
}

async function main() {
    fs.mkdirSync(NODE_MODULES, { recursive: true });
    for (const p of PACKAGES) {
        await fetchAndExtract(p);
    }

    // Apply the source-map stub patch to drop the @jridgewell dependency
    // tree. Idempotent — overwrites every fetch, even when the version
    // didn't change. Tiny cost.
    //
    // Two patch sites needed because terser ships in two forms:
    //   - lib/main.js (ESM) — imports from lib/sourcemap.js (we replace it
    //     with PATCH_SOURCEMAP, defined above).
    //   - dist/bundle.min.js (UMD/CJS) — Node's CJS resolver picks this for
    //     `require('terser')`. The bundle's first line calls
    //     require('@jridgewell/source-map'); we substitute an empty object.
    //     SourceMapGenerator/SourceMapConsumer go undefined inside the
    //     bundle, but they're only touched if the caller passes
    //     `sourceMap: ...` to minify(), which we never do.
    const libSourcemap = path.join(NODE_MODULES, 'terser', 'lib', 'sourcemap.js');
    if (fs.existsSync(libSourcemap)) {
        fs.writeFileSync(libSourcemap, PATCH_SOURCEMAP);
        console.log('Patched terser/lib/sourcemap.js (source maps disabled).');
    }

    const distBundle = path.join(NODE_MODULES, 'terser', 'dist', 'bundle.min.js');
    if (fs.existsSync(distBundle)) {
        const original = fs.readFileSync(distBundle, 'utf8');
        // Replace both forms: CJS require (in UMD top), and AMD define list.
        const patched = original
            .replace(`require('@jridgewell/source-map')`, '{}')
            .replace(`['exports', '@jridgewell/source-map']`, `['exports', null]`);
        if (patched !== original) {
            fs.writeFileSync(distBundle, patched);
            console.log('Patched terser/dist/bundle.min.js (source maps disabled).');
        }
    }

    // Clean up any old @jridgewell/* directories from a previous fetch so
    // the on-disk layout matches the trust footprint.
    const oldJridgewell = path.join(NODE_MODULES, '@jridgewell');
    if (fs.existsSync(oldJridgewell)) {
        fs.rmSync(oldJridgewell, { recursive: true, force: true });
        console.log('Removed @jridgewell/* (no longer needed after sourcemap patch).');
    }

    // Sanity check: load terser and confirm version.
    require(path.join(NODE_MODULES, 'terser'));
    console.log(`\nterser ${require(path.join(NODE_MODULES, 'terser', 'package.json')).version} ready at ${path.join(NODE_MODULES, 'terser')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
