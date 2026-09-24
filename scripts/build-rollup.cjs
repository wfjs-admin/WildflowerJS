#!/usr/bin/env node
/**
 * Build all WildflowerJS bundle variants using vendored rollup + vendored terser.
 *
 * Pipeline: rollup (bundling + DCE only) -> terser (minify + property mangling).
 * Both tools are vendored locally (tools/rollup/, tools/terser/) and SHA-512-pinned.
 * No npm install runs. No postinstall scripts. No @rollup/plugin-* packages —
 * the only "plugin" is an inline transform that substitutes __DEV__ and feature
 * flags before rollup sees the source. Dropping plugins keeps the trust footprint
 * minimal: rollup tarball + terser tarball + their few SHA-pinned transitive deps.
 *
 * 7 entry points (nano, mini-pool, mini, lite, core, spa, full) x 3 modes
 * (raw, dev-minified, prod-minified) = 21 IIFE variants, plus an ES-module
 * twin of each dev and min file (.esm.dev.js / .esm.min.js) = 35 files.
 *
 * Usage:
 *   node scripts/build-rollup.cjs                # build all 35
 *   node scripts/build-rollup.cjs lite.min       # filter (substring match on output filename)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const ROLLUP_DIR = path.join(ROOT, 'tools', 'rollup');
const TERSER_DIR = path.join(ROOT, 'tools', 'terser', 'node_modules', 'terser');

// Source / dist layout. Main repo uses www/js/src and www/js/dist; the published
// /public package uses src/ and dist/ at the root. Auto-detect.
const SRC_CANDIDATES = [
    path.join(ROOT, 'www', 'js', 'src'),
    path.join(ROOT, 'src'),
];
const SRC = SRC_CANDIDATES.find((p) => fs.existsSync(path.join(p, 'index.js'))) || SRC_CANDIDATES[0];

// On the spike/unified-graph-core branch Meadow is the only reactive core (the
// legacy ReactiveStateManager has been deleted), so there is no core switch and
// the build writes to the normal `dist`.
const DEFAULT_DIST = SRC === SRC_CANDIDATES[0] ? 'www/js/dist' : 'dist';
const DIST = path.resolve(ROOT, process.env.WF_BUILD_OUTDIR || DEFAULT_DIST);

const MANGLE_JSON = path.join(ROOT, 'mangle.json');
const MANGLE_PROPS_JSON = path.join(ROOT, 'mangle-properties.json');

if (!fs.existsSync(path.join(ROLLUP_DIR, 'package.json'))) {
    console.error(`rollup not found at ${ROLLUP_DIR}`);
    console.error(`Run: node scripts/fetch-rollup.cjs`);
    process.exit(1);
}
if (!fs.existsSync(TERSER_DIR)) {
    console.error(`terser not found at ${TERSER_DIR}`);
    console.error(`Run: node scripts/fetch-terser.cjs`);
    process.exit(1);
}
if (!fs.existsSync(MANGLE_PROPS_JSON)) {
    console.error(`mangle-properties.json not found at ${MANGLE_PROPS_JSON}`);
    process.exit(1);
}

// -----------------------------------------------------------------------------
// Load mangle config (single source of truth, shared with rollup.config.js).
// -----------------------------------------------------------------------------
const mangleConfig = JSON.parse(fs.readFileSync(MANGLE_PROPS_JSON, 'utf8'));
const MANGLE_PROPERTIES = mangleConfig.mangle;
const DOM_EXPANDO_RESERVED = mangleConfig.reserved;
if (!Array.isArray(MANGLE_PROPERTIES) || MANGLE_PROPERTIES.length < 100) {
    throw new Error('mangle-properties.json: "mangle" array missing or too short');
}
console.log(`Loaded ${MANGLE_PROPERTIES.length} mangle properties + ${DOM_EXPANDO_RESERVED.length} reserved expandos from mangle-properties.json`);
console.log(`Source: ${SRC}`);
console.log(`Output: ${DIST}`);

// Read package.json version
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '1.0.0';

// -----------------------------------------------------------------------------
// Banner / footer (mirrors rollup.config.js)
// -----------------------------------------------------------------------------
// `/*!` (not `/**`) so terser's `comments: /^!/` keeps the license notice in
// the minified builds too: CDN users only ever see the .min.js file.
const banner = `/*!
 * WildflowerJS v${VERSION}
 * Lightweight reactive framework - no build step, no virtual DOM
 * https://github.com/wfjs-admin/WildflowerJS
 *
 * Copyright (c) ${new Date().getFullYear()} WildflowerJS Contributors
 * Released under the MIT License
 */`;

// Globals for script-tag usage. `window` on a page; `self` in a Web Worker,
// where the same file loads headless (no document: no scan, no listeners) and
// `self.wildflower` is the instance the thread extension's worker half uses.
const globalTarget = `(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null))`;
const footers = {
    core: `
// Expose globals for script tag usage (window on a page, self in a worker)
(function (g) { if (!g) return;
    g.WildflowerJS = WildflowerBundle.WildflowerJS;
    g.wildflower = WildflowerBundle.wildflower;
})(${globalTarget});`,
    spa: `
// Expose globals for script tag usage (window on a page, self in a worker)
(function (g) { if (!g) return;
    g.WildflowerJS = WildflowerBundle.WildflowerJS;
    g.wildflower = WildflowerBundle.wildflower;
    g.RouteManager = WildflowerBundle.RouteManager;
})(${globalTarget});`,
    full: `
// Expose globals for script tag usage (window on a page, self in a worker)
(function (g) { if (!g) return;
    g.WildflowerJS = WildflowerBundle.WildflowerJS;
    g.wildflower = WildflowerBundle.wildflower;
    g.RouteManager = WildflowerBundle.RouteManager;
    g.SSRManager = WildflowerBundle.SSRManager;
    g.SSRProtectionContext = WildflowerBundle.SSRProtectionContext;
    g.SSRPhase = WildflowerBundle.SSRPhase;
})(${globalTarget});`,
    // Probe artifact (thread extension, Probe 7): the headless reactive graph
    // loaded into a Web Worker, where `self` is the global and `window` is absent.
    graph: `
if (typeof self !== 'undefined') {
    self.WildflowerGraph = WildflowerBundle;
}`,
};

// -----------------------------------------------------------------------------
// Feature flags (mirrors rollup.config.js)
// -----------------------------------------------------------------------------
const FEATURES_ALL = {
    __FEATURE_PLUGINS__: 'true',
    __FEATURE_PORTALS__: 'true',
    __FEATURE_TRANSITIONS__: 'true',
    __FEATURE_SSR__: 'false',
    __FEATURE_LISTS__: 'true',
    __FEATURE_QUERY__: 'false',
};
// data-query rides the SSR tier by decision:
// "you use full for SSR, you get data-query too."
const FEATURES_FULL = { ...FEATURES_ALL, __FEATURE_SSR__: 'true', __FEATURE_QUERY__: 'true' };
const FEATURES_LITE = {
    __FEATURE_PLUGINS__: 'false',
    __FEATURE_PORTALS__: 'false',
    __FEATURE_TRANSITIONS__: 'false',
    __FEATURE_SSR__: 'false',
    __FEATURE_LISTS__: 'true',
    __FEATURE_QUERY__: 'false',
};
// NANO: below mini — everything in lite/mini minus the data-list render cluster.
// __FEATURE_LISTS__ = false constant-folds the list call-sites out of the
// nano-shipped modules (crash-safe) and drops the cluster spread.
const FEATURES_NANO = { ...FEATURES_LITE, __FEATURE_LISTS__: 'false' };

function defines(features, dev, headless) {
    // __VERSION__ is the single source of the version string inside the bundle
    // (wildflower.version and the DevTools hook); it comes from package.json.
    // __HEADLESS__ is true only for bundles of the reactive graph with no
    // framework around it (the thread extension's worker half): it folds the
    // facade's framework-only surface (persistence, component/props paths,
    // the computed-eval owner stack) out of those bundles. Every tier is false.
    return { __DEV__: String(!!dev), __HEADLESS__: String(!!headless), __VERSION__: JSON.stringify(VERSION), ...features };
}

// -----------------------------------------------------------------------------
// Build configurations
// -----------------------------------------------------------------------------
const configs = [
    // NANO (below mini: no data-list render cluster) — the interactive-widget /
    // single-file-artifact tier. __FEATURE_LISTS__ = false folds list call-sites out.
    { entry: 'index.nano.js', file: 'wildflower.nano.js',      features: FEATURES_NANO, dev: true,  minify: false, mangleProps: false, footer: 'core' },
    { entry: 'index.nano.js', file: 'wildflower.nano.dev.js',  features: FEATURES_NANO, dev: true,  minify: true,  mangleProps: false, footer: 'core' },
    { entry: 'index.nano.js', file: 'wildflower.nano.min.js',  features: FEATURES_NANO, dev: false, minify: true,  mangleProps: true,  footer: 'core' },

    // MINI-POOL (mini's composition with pools in place of lists) — the lean
    // games/simulation tier. Same FEATURES_NANO flags: __FEATURE_LISTS__ = false
    // folds list call-sites out; PoolRenderer comes in via the entry point.
    { entry: 'index.mini-pool.js', file: 'wildflower.mini-pool.js',     features: FEATURES_NANO, dev: true,  minify: false, mangleProps: false, footer: 'core' },
    { entry: 'index.mini-pool.js', file: 'wildflower.mini-pool.dev.js', features: FEATURES_NANO, dev: true,  minify: true,  mangleProps: false, footer: 'core' },
    { entry: 'index.mini-pool.js', file: 'wildflower.mini-pool.min.js', features: FEATURES_NANO, dev: false, minify: true,  mangleProps: true,  footer: 'core' },

    // CORE
    { entry: 'index.js',      file: 'wildflower.js',           features: FEATURES_ALL,  dev: true,  minify: false, mangleProps: false, footer: 'core' },
    { entry: 'index.js',      file: 'wildflower.dev.js',       features: FEATURES_ALL,  dev: true,  minify: true,  mangleProps: false, footer: 'core' },
    { entry: 'index.js',      file: 'wildflower.min.js',       features: FEATURES_ALL,  dev: false, minify: true,  mangleProps: true,  footer: 'core' },

    // MINI
    { entry: 'index.mini.js', file: 'wildflower.mini.js',      features: FEATURES_LITE, dev: true,  minify: false, mangleProps: false, footer: 'core' },
    { entry: 'index.mini.js', file: 'wildflower.mini.dev.js',  features: FEATURES_LITE, dev: true,  minify: true,  mangleProps: false, footer: 'core' },
    { entry: 'index.mini.js', file: 'wildflower.mini.min.js',  features: FEATURES_LITE, dev: false, minify: true,  mangleProps: true,  footer: 'core' },

    // LITE
    { entry: 'index.lite.js', file: 'wildflower.lite.js',      features: FEATURES_LITE, dev: true,  minify: false, mangleProps: false, footer: 'core' },
    { entry: 'index.lite.js', file: 'wildflower.lite.dev.js',  features: FEATURES_LITE, dev: true,  minify: true,  mangleProps: false, footer: 'core' },
    { entry: 'index.lite.js', file: 'wildflower.lite.min.js',  features: FEATURES_LITE, dev: false, minify: true,  mangleProps: true,  footer: 'core' },

    // SPA
    { entry: 'index.spa.js',  file: 'wildflower.spa.js',       features: FEATURES_ALL,  dev: true,  minify: false, mangleProps: false, footer: 'spa' },
    { entry: 'index.spa.js',  file: 'wildflower.spa.dev.js',   features: FEATURES_ALL,  dev: true,  minify: true,  mangleProps: false, footer: 'spa' },
    { entry: 'index.spa.js',  file: 'wildflower.spa.min.js',   features: FEATURES_ALL,  dev: false, minify: true,  mangleProps: true,  footer: 'spa' },

    // FULL (with SSR)
    { entry: 'index.full.js', file: 'wildflower.full.js',      features: FEATURES_FULL, dev: true,  minify: false, mangleProps: false, footer: 'full' },
    { entry: 'index.full.js', file: 'wildflower.full.dev.js',  features: FEATURES_FULL, dev: true,  minify: true,  mangleProps: false, footer: 'full' },
    { entry: 'index.full.js', file: 'wildflower.full.min.js',  features: FEATURES_FULL, dev: false, minify: true,  mangleProps: true,  footer: 'full' },

    // PROBE (thread extension, Probe 7): the reactive graph + EntityHandle
    // alone, for loading into a Web Worker. Not a shipped tier: not in the
    // 21-lane matrix, not in the sizes check; the .raw/.mangled suffixes keep
    // it out of the ESM-twin loop below and out of the .min.js size listing.
    { entry: 'index.reactive-graph-probe.js', file: 'wildflower.reactive-graph-probe.raw.js',     features: FEATURES_NANO, dev: true,  minify: false, mangleProps: false, footer: 'graph' },
    { entry: 'index.reactive-graph-probe.js', file: 'wildflower.reactive-graph-probe.mangled.js', features: FEATURES_NANO, dev: false, minify: true,  mangleProps: true,  footer: 'graph' },

    // THREAD EXTENSION (packages/threads): the isomorphic file. Public API
    // only on both sides (the worker loads a tier file headless and uses
    // wildflower.store / subscribe / batch), so there is nothing to mangle;
    // built here for the defines and the pinned terser. Own entry and output
    // paths; not a tier: not in the 21-lane matrix, not in the sizes check,
    // no ESM twin (see the loop below). Filter: `node scripts/build-rollup.cjs threads`.
    ...threadsConfigs(),
];

function threadsConfigs() {
    const dir = path.join(ROOT, 'packages', 'threads');
    const entryPath = path.join(dir, 'src', 'index.js');
    if (!fs.existsSync(entryPath)) return [];
    const tpkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const tbanner = `/*!
 * ${tpkg.name} v${tpkg.version}
 * ${tpkg.description}
 *
 * Copyright (c) ${new Date().getFullYear()} WildflowerJS Contributors
 * Released under the MIT License
 */`;
    const base = { entryPath, features: FEATURES_NANO, banner: tbanner };
    // The framework file: the same runtime plus the WildflowerJS layer
    // (src/wf.js), which registers the mirror as a store through public API.
    // Each output is also written to www/js/extensions/ (gitignored), the
    // path the site's demos and docs load it from; sync-www publishes that
    // directory, unlike js/dist.
    const wfEntry = path.join(dir, 'src', 'wf.js');
    const site = (file) => path.join(ROOT, 'www', 'js', 'extensions', file);
    return [
        { ...base, file: 'threads.js',        outPath: path.join(dir, 'dist', 'threads.js'),        alsoWrite: site('threads.js'),        dev: true,  minify: false, mangleProps: false },
        { ...base, file: 'threads.min.js',    outPath: path.join(dir, 'dist', 'threads.min.js'),    alsoWrite: site('threads.min.js'),    dev: false, minify: true,  mangleProps: false },
        { ...base, file: 'threads.wf.js',     outPath: path.join(dir, 'dist', 'threads.wf.js'),     alsoWrite: site('threads.wf.js'),     dev: true,  minify: false, mangleProps: false, entryPath: wfEntry },
        { ...base, file: 'threads.wf.min.js', outPath: path.join(dir, 'dist', 'threads.wf.min.js'), alsoWrite: site('threads.wf.min.js'), dev: false, minify: true,  mangleProps: false, entryPath: wfEntry },
    ];
}

// ES module twins: every tier's .dev.js and .min.js also ships as
// .esm.dev.js / .esm.min.js (format 'es', default export = the instance,
// named exports as in the entry file). Same defines, same terser settings.
// The instance still registers window.wildflower (createInstance does that),
// so a page behaves the same whichever file it loads.
for (const c of configs.filter(c => /\.(dev|min)\.js$/.test(c.file) && !c.outPath)) {
    configs.push({ ...c, file: c.file.replace(/\.(dev|min)\.js$/, '.esm.$1.js'), format: 'es' });
}

// Optional maintainer-local variant extensions (repo-internal tooling; the
// extension file is not part of the published package). Absent file = no-op.
try { configs.push(...require('./build-variants.bench.cjs')); } catch (_) { /* no local variants */ }

// -----------------------------------------------------------------------------
// Property mangling regex
// -----------------------------------------------------------------------------
function escapeForRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const mangleRegex = new RegExp(`^(${MANGLE_PROPERTIES.map(escapeForRegex).join('|')})$`);

// -----------------------------------------------------------------------------
// Load vendored rollup + terser
// -----------------------------------------------------------------------------
const rollup = require(ROLLUP_DIR);
const terser = require(TERSER_DIR);
const baseNameCache = JSON.parse(fs.readFileSync(MANGLE_JSON, 'utf8'));

// -----------------------------------------------------------------------------
// Inline replace-plugin: substitutes __DEV__ and feature flags before rollup
// sees the source. Replaces @rollup/plugin-replace functionality (~10 lines vs
// a tarball + transitive deps). Word boundaries prevent partial matches.
// -----------------------------------------------------------------------------
function makeReplacePlugin(replacements) {
    const entries = Object.entries(replacements);
    const re = new RegExp('\\b(' + entries.map(([k]) => escapeForRegex(k)).join('|') + ')\\b', 'g');
    const map = Object.fromEntries(entries);
    return {
        name: 'wf-defines',
        transform(code) {
            const out = code.replace(re, (m) => (m in map ? map[m] : m));
            return out === code ? null : { code: out, map: null };
        },
    };
}

// -----------------------------------------------------------------------------
// Terser config (mirrors rollup.config.js exactly)
// -----------------------------------------------------------------------------
const terserBaseCompress = {
    drop_console: false,
    passes: 3,
    dead_code: true,
    drop_debugger: true,
    conditionals: true,
    evaluate: true,
    booleans: true,
    loops: true,
    unused: true,
    hoist_funs: true,
    hoist_vars: false,
    if_return: true,
    join_vars: true,
    sequences: true,
    properties: true,
    comparisons: true,
    inline: true,
    reduce_vars: true,
    collapse_vars: true,
};
const terserBaseMangle = {
    reserved: ['WildflowerJS', 'wildflower', 'RouteManager', 'SSRManager'],
    properties: false,
};
const terserFormat = { comments: /^!/ };

function makeTerserOpts(prod) {
    const opts = {
        compress: { ...terserBaseCompress },
        mangle: { ...terserBaseMangle },
        format: { ...terserFormat },
    };
    if (prod) {
        opts.compress.pure_funcs = ['console.log', 'console.info', 'console.debug', 'console.trace'];
        opts.mangle.properties = {
            regex: mangleRegex,
            reserved: DOM_EXPANDO_RESERVED,
        };
        opts.nameCache = JSON.parse(JSON.stringify(baseNameCache));
    }
    return opts;
}

// -----------------------------------------------------------------------------
// Filter (CLI arg)
// -----------------------------------------------------------------------------
const filter = process.argv[2];
const targets = filter ? configs.filter(c => c.file.includes(filter)) : configs;
if (filter && targets.length === 0) {
    console.error(`No bundles match filter: ${filter}`);
    console.error(`Available: ${configs.map(c => c.file).join(', ')}`);
    process.exit(1);
}

// -----------------------------------------------------------------------------
// Build loop
// -----------------------------------------------------------------------------
fs.mkdirSync(DIST, { recursive: true });

function fmtBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function buildOne(cfg) {
    const entry = cfg.entryPath || path.join(SRC, cfg.entry);
    const out = cfg.outPath || path.join(DIST, cfg.file);
    if (cfg.outPath) fs.mkdirSync(path.dirname(out), { recursive: true });
    const bannerText = cfg.banner || banner;
    const defs = defines(cfg.features, cfg.dev, cfg.headless);

    process.stdout.write(`${cfg.file.padEnd(28)} ... `);

    // Step 1: rollup bundles + applies build-time defines.
    let bundled;
    try {
        const bundle = await rollup.rollup({
            input: entry,
            plugins: [makeReplacePlugin(defs)],
            // Suppress missing-export warnings; our source is self-contained ESM
            onwarn(warning, warn) {
                if (warning.code === 'CIRCULAR_DEPENDENCY') return;
                if (warning.code === 'EVAL') return;
                warn(warning);
            },
        });
        const { output } = await bundle.generate(cfg.format === 'es'
            ? { format: 'es', banner: bannerText }
            : { format: 'iife', name: 'WildflowerBundle', banner: bannerText, footer: footers[cfg.footer] });
        await bundle.close();
        bundled = output[0].code;
    } catch (e) {
        process.stdout.write(`ROLLUP FAILED\n`);
        console.error(e.stack || e.message);
        return false;
    }

    // Step 2: terser minifies (only for .dev.js and .min.js variants).
    let finalCode = bundled;
    if (cfg.minify) {
        const opts = makeTerserOpts(cfg.mangleProps);
        if (cfg.format === 'es') opts.module = true; // keep import/export, module-safe compress
        try {
            const result = await terser.minify(bundled, opts);
            if (result.error) {
                process.stdout.write(`TERSER FAILED\n`);
                console.error(result.error);
                return false;
            }
            finalCode = result.code;
        } catch (e) {
            process.stdout.write(`TERSER FAILED\n`);
            console.error(e.message);
            return false;
        }
    }

    // Step 3: write output and compute compressed sizes.
    fs.writeFileSync(out, finalCode);
    if (cfg.alsoWrite) {
        fs.mkdirSync(path.dirname(cfg.alsoWrite), { recursive: true });
        fs.writeFileSync(cfg.alsoWrite, finalCode);
    }
    const buf = Buffer.from(finalCode);
    const gz = zlib.gzipSync(buf, { level: 9 });
    const br = zlib.brotliCompressSync(buf, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    if (cfg.file.endsWith('.min.js')) {
        fs.writeFileSync(`${out}.gz`, gz);
        fs.writeFileSync(`${out}.br`, br);
    }
    process.stdout.write(`${fmtBytes(buf.length).padStart(9)}  gz ${fmtBytes(gz.length).padStart(9)}  br ${fmtBytes(br.length).padStart(9)}\n`);
    return true;
}

(async () => {
    const t0 = Date.now();
    let failed = 0;
    for (const cfg of targets) {
        const ok = await buildOne(cfg);
        if (!ok) failed++;
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`\nDone in ${dt}s. ${targets.length - failed}/${targets.length} succeeded.`);
    console.log(`Output: ${DIST}`);
    if (failed > 0) process.exit(1);
})();
