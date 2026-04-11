# Changelog

All notable changes to WildflowerJS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-10

### Added
- Core reactive framework with component system
- Reactive state management with computed properties and dependency tracking
- Store system for cross-component state sharing
- List rendering with automatic keyed reconciliation
- Conditional rendering (data-show, data-render)
- Event handling with modifiers (throttle, debounce, self, outside, once, passive, capture)
- Two-way data binding (data-model) with modifiers (trim, number, debounce, lazy)
- Attribute, style, and class binding (data-bind-attr, data-bind-style, data-bind-class)
- Client-side routing with history and hash modes
- Server-side rendering with hydration
- Plugin system architecture
- Portal, modal, and transition systems
- Entity pools (data-pool) for high-frequency DOM rendering
- Anti-FOUC data-cloak system
- `wildflower.whenSettled()` API for deterministic async waits
- 4 build variants (core, lite, spa, full)
- Comprehensive test suite (3,646 tests in real Chromium)

### Security
- Expression evaluator blocklist for unsafe patterns (eval, Function, globalThis, window)
- Pool renderer attribute blocklist and URL protocol sanitization
- HTML sanitizer routing for data-bind-html and router outlet
- data: URI blocking (except data:image/) in URL-bearing attributes
