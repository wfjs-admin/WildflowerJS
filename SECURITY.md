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
