# Contributing to WildflowerJS

Thanks for your interest in contributing!

**Please open an issue before submitting a pull request.** This lets us discuss whether the change fits the project's direction before you invest time writing code.

## Bug Reports

- Open a GitHub Issue with a minimal reproduction case
- Describe expected vs. actual behavior

## Development Setup

```bash
git clone https://github.com/wfjs-admin/WildflowerJS.git
cd wildflowerjs
npm install
npm run test:setup   # one-time: installs test browser
npm run build
npm test
```

## Running the Tests

The suite runs in a real browser (Chromium via Playwright):

```bash
npm test                          # full suite, single run
npm test -- tests/lists.test.js   # one file
```

### If you see "Browser connection was closed"

On machines with many CPU cores, a run can occasionally abort with
`Browser connection was closed while running tests. Was the page closed
unexpectedly?` and **zero test failures**. This is a known upstream vitest
browser-mode issue ([vitest-dev/vitest #10300]) where a Chromium renderer
reaches its memory ceiling and the page is killed mid-run. It is transient and
not caused by your change; a clean re-run passes.

If you hit it, re-run the affected file, or use the resilient runner, which
retries automatically on that exact signature (and only that signature, never on
a run with real test failures):

```bash
npm run test:retry
```

[vitest-dev/vitest #10300]: https://github.com/vitest-dev/vitest/pull/10300

## Pull Requests

1. Fork the repo and create a feature branch
2. Make changes in `src/`, then `npm run build`
3. Add or update tests in `tests/` covering your changes
4. Run tests: `npm test`
5. Submit a PR referencing the related issue

## How PRs Are Reviewed

Pull requests are reviewed with the help of AI-assisted code analysis against the full internal test suite (~3,400 tests across 8 build variants). This means:

- **Reviews may take a few days.** Your PR is evaluated against the complete codebase for correctness, performance impact, and pattern consistency, not just a quick skim.
- **Integration goes through an internal pipeline.** Accepted changes are merged into the development tree, tested, and published through our build process. Your PR will be closed with a reference to the integrating commit rather than merged directly on GitHub.
- **We may ask questions or suggest adjustments.** This is normal and not a sign your contribution isn't valued. The codebase has specific patterns and performance constraints that aren't always obvious from the public API.

The best way to get a PR accepted quickly: open an issue first, wait for feedback on the approach, then submit focused changes with tests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
