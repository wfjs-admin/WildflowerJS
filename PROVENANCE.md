# Provenance and Supply-Chain Trust Model

WildflowerJS is built without `npm install` in the framework's own build path. This document describes precisely what that buys you, what it doesn't, and how to verify the claims yourself.

The honest summary: we close the post-publish tampering vector and remove the postinstall-script attack surface entirely. We do **not** close the moment-of-publish vector against our three pinned upstreams (rollup, terser, acorn), because none of them currently ships SLSA provenance from upstream CI.

## What ships, and what's vendored

There are two pipelines. They have different trust profiles.

**Framework build pipeline** (`npm run build` → produces `www/js/dist/wildflower.*.js`):
- Three SHA-512-pinned tarballs total: `rollup` 3.30.0, `terser` 5.46.2, `acorn` 8.16.0.
- Fetched directly from `https://registry.npmjs.org/` by `scripts/fetch-rollup.cjs` and `scripts/fetch-terser.cjs`. No `npm install`. No package manager involved.
- Each fetch script has the SHA-512 baked in as a constant. Mismatch is a hard failure.
- Extracted into `tools/rollup/` and `tools/terser/`. Idempotent: subsequent runs check the recorded version + integrity and skip the network call.
- Result: the artifacts published to npm and CDN are produced by a build path whose entire third-party trust footprint is three byte-identical, content-addressed tarballs.

**Test/lint/dev pipeline** (`npm install` → `node_modules/`):
- Used only for vitest, eslint, playwright, and other developer tools. Never produces a published artifact.
- Root `.npmrc` sets `ignore-scripts=true`. **No `preinstall`, `install`, or `postinstall` script from any package, direct or transitive, is allowed to execute.** This is the same defense-in-depth that would have neutralized event-stream, ua-parser-js, and the Shai-Hulud worm class.
- Same `.npmrc` pins `registry=https://registry.npmjs.org/` so a typo'd or hijacked alternate registry can't slip in modified tarballs.
- Side effect: playwright's auto-download of Chromium is suppressed. Run `npx playwright install` once after the first `npm install` on a fresh machine.

What a downstream WildflowerJS user pulls from npm or our CDN is the output of the first pipeline. The second pipeline never touches their machine.

## The eliminated dependency tree

A naive vendoring of terser would also pull in `@jridgewell/source-map`, which transitively pulls four more `@jridgewell/*` packages, eight tarballs total instead of three.

We don't pull them. `scripts/fetch-terser.cjs` patches the fetched terser at extraction time:

1. Replaces `terser/lib/sourcemap.js` (the ESM entry's helper) with a stub `SourceMap()` that throws if anyone enables source maps.
2. Replaces the CJS bundle's `require('@jridgewell/source-map')` call with `{}` so Node's CJS resolver never traverses the tree.
3. Drops the five `@jridgewell/*` tarballs from the `PACKAGES` array.

The build never sets `terser.minify(code, { sourceMap: ... })`, so this code path is dead weight in our usage. The stub fails loudly if a future config change tries to enable source maps, so any drift is visible immediately rather than silently producing broken maps.

Net effect: 8 → 3 vendored tarballs, byte-identical build output, full test suite green.

## The trust layers

| Layer | Question answered | Status |
|-------|-------------------|--------|
| SHA-512 tarball pin | "Did the bytes get tampered with in transit or at rest after we pinned them?" | ✅ enforced by every build |
| `ignore-scripts=true` | "Can a malicious `postinstall` execute on `npm install`?" | ✅ globally blocked for the dev path |
| Registry pin | "Could a typo or hijacked mirror slip in modified tarballs?" | ✅ canonical npm only |
| Dependency-tree minimization | "How many third parties have to be trustworthy?" | ✅ three (rollup, terser, acorn) |
| npm registry signature | "Did this tarball come through npm's signing infrastructure?" | ✅ inherited from npm |
| **SLSA provenance** | **"Was this tarball produced by the upstream's declared CI workflow, not hand-uploaded by a compromised maintainer account?"** | ❌ **upstream gap (see below)** |

## The gap we don't close

SHA-512 pinning is robust against post-pinning tampering. It is **not** robust against the moment-of-publish vector, which is exactly how event-stream, ua-parser-js, and the Shai-Hulud worm worked: a malicious version was pushed to npm by a compromised account, and consumers who pinned at that moment locked in the malicious bytes faithfully forever.

SLSA (Supply-chain Levels for Software Artifacts) closes this gap by binding the published artifact to a specific upstream CI run from a specific commit, verifiable through the rekor transparency log. As of an audit on 2026-05-05:

| Package | Pinned version | SLSA provenance from upstream |
|---------|----------------|-------------------------------|
| rollup | 3.30.0 | ❌ none |
| terser | 5.46.2 | ❌ none |
| acorn | 8.16.0 | ❌ none |

We have not solved this. We have minimized the attack surface (three packages, all widely used and watched) and locked the bytes against post-publish drift, but we cannot independently verify these three tarballs were built by their declared upstream CI. If `https://registry.npmjs.org/<pkg>/<ver>` had served a malicious tarball at the moment we pinned it, we would have faithfully locked that malicious version.

This is the gap. We name it because the alternative, claiming a stronger guarantee than we deliver, is exactly the kind of overreach that erodes trust when an audit catches it.

## How to verify the claims yourself

Re-run the upstream provenance audit (the table above) before trusting it for any compliance purpose, since upstream state may have changed since 2026-05-05:

```bash
for pkg in 'rollup/3.30.0' 'terser/5.46.2' 'acorn/8.16.0'; do
  echo "=== $pkg ==="
  curl -s "https://registry.npmjs.org/$pkg" | jq '.dist.attestations'
done
```

A `null` result means upstream still doesn't publish provenance.

Verify our pinned SHA-512 hashes match what npm currently serves:

```bash
for pkg in 'rollup/3.30.0' 'terser/5.46.2' 'acorn/8.16.0'; do
  echo -n "$pkg integrity: "
  curl -s "https://registry.npmjs.org/$pkg" | jq -r '.dist.integrity'
done
```

Compare against the `INTEGRITY` constants in `scripts/fetch-rollup.cjs` and the `PACKAGES` array in `scripts/fetch-terser.cjs`.

Verify a clean build from a fresh clone:

```bash
git clone https://github.com/<org>/wildflowerjs.git wf-verify && cd wf-verify
node scripts/fetch-rollup.cjs   # SHA-512 verified
node scripts/fetch-terser.cjs   # SHA-512 verified, sourcemap stub patched in
node scripts/build-rollup.cjs   # produces www/js/dist/*
shasum -a 256 www/js/dist/wildflower.full.min.js
```

The same input commit produces the same bytes. If our published CDN artifact has a different hash than your locally rebuilt one, something is wrong on our side and we want to hear about it.

## Roadmap

The audit recommendation we are still working through, in priority order:

1. **SLSA-attest our own releases.** Use the OpenSSF `slsa-github-generator` action to produce signed provenance for `wildflower.full.min.js` and friends as part of the publish workflow. Doesn't address the upstream gap, but completes the chain on our side: anyone pulling our CDN or npm package can verify the artifact came from our publish workflow on this repo. Targeted for v1.2 or v1.3.
2. **Optional `--verify-attestations` step in the fetch scripts.** Once any of our three upstreams (rollup, terser, acorn) starts publishing provenance, add a verification step that checks the rekor signature and asserts the source repo matches an allowlist. Until at least one upstream opts in, this is mostly a no-op.

What we're explicitly **not** doing:

- Switching the primary build to a builder with provenance just for the badge. esbuild ships SLSA provenance and was evaluated, but benchmarked roughly 25% slower on the krausest swap1k hot loop than rollup. Worth reconsidering when esbuild's perf gap closes.
- Adding a package manager. SLSA verification is a `curl` plus a small Node script, not a reason to introduce dependency installation into our build path.
- Adding transitive deps for verification tooling. Anything we add to `scripts/fetch-*.cjs` has to meet the same trust criteria (small, auditable, vendorable) that motivated the current footprint.

## References

- [SLSA framework](https://slsa.dev): levels, terminology, threat model
- [Sigstore](https://www.sigstore.dev): cosign / fulcio / rekor stack
- [npm `--provenance`](https://docs.npmjs.com/generating-provenance-statements): how upstream packages opt in
- [`slsa-github-generator`](https://github.com/slsa-framework/slsa-github-generator): OpenSSF Action for generating provenance from GitHub Actions
- `docs/future/SLSA_PROVENANCE_INVESTIGATION.md`: the underlying audit and roadmap analysis
- `scripts/fetch-rollup.cjs`, `scripts/fetch-terser.cjs`: the actual fetch and verify code
- `.npmrc`: the ignore-scripts and registry pinning
