# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | Yes                |
| < 1.0   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in WildflowerJS, please report it responsibly.

**Do not open a public issue.** Instead, email security@wildflowerjs.com with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Scope

WildflowerJS is a client-side framework. Security concerns typically involve:

- XSS through `data-bind-html` (warns in dev builds; configure `wildflower.setHtmlSanitizer()` with DOMPurify or similar)
- Expression evaluation safety (CSP-compliant evaluator available)
- Prototype pollution in state management

We take all reports seriously regardless of severity.

## Supply Chain

WildflowerJS ships as a single pre-built JavaScript file. Users who follow the documented integration path (one `<script>` tag pointing at the CDN-hosted bundle) never run `npm install` to use the framework, so the npm postinstall / build-time supply-chain attack class (Shai-Hulud, event-stream, ua-parser-js, node-ipc, etc.) does not apply to framework consumers.

Maintainers building the framework from source use a vendored, SHA-512-pinned toolchain (rollup + terser, fetched once via direct tarball download with integrity verification, no `npm install` during the build, no postinstall scripts). The build trust footprint is 8 frozen tarballs pinned in `scripts/fetch-rollup.cjs` and `scripts/fetch-terser.cjs`. Version bumps require explicit hash updates and changelog review.

If you spot a way to introduce attacker-controlled code into a published WildflowerJS bundle through the build path, treat it as in-scope and report via the email above.
