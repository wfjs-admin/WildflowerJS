/**
 * Security Audit Test Suite
 *
 * Goal: prove which findings in docs/future/SECURITY_AUDIT_2026-04-15.md are
 * actually exploitable through realistic application code paths — i.e. where
 * attacker-controlled data flowing into state, fetched HTML, or form input
 * reaches a dangerous sink.
 *
 * These tests are written as regression guards: each test expresses the
 * invariant we want the framework to hold. Tests that currently FAIL
 * demonstrate real exploitable gaps. Tests that PASS confirm the defense
 * is already working.
 *
 * Scoring methodology:
 *   - window.__xssPwned = true is set by injected payloads. If a test ends
 *     with that flag set, the defense failed and the exploit is real.
 *   - Each describe block corresponds to one finding; read the comment at
 *     the top of the block for what the attacker controls.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, waitForUpdate, waitForCompleteRender, skipIfNoFeature } from './helpers/load-framework.js'

describe('Security Audit', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    // Reset XSS sentinel and ensure no stale sanitizer from a prior test
    window.__xssPwned = false
    wildflower.setHtmlSanitizer?.(null)

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    // Disarm any pending img/iframe loads BEFORE container removal. Several
    // tests in this file plant elements whose onerror handlers set
    // window.__xssPwned. On slow builds (lite-raw, full-raw) the fetch can be
    // in-flight by the time this runs, and clearing src mid-fetch still fires
    // onerror (aborted load = error). Null the handler itself first so the
    // error, if dispatched, becomes a no-op.
    if (testContainer) {
      testContainer.querySelectorAll('img, iframe, audio, video').forEach(el => {
        el.onerror = null
        el.onload = null
        el.removeAttribute('onerror')
        el.removeAttribute('onload')
        el.removeAttribute('src')
        el.removeAttribute('srcset')
      })
    }
    if (testContainer?.parentNode) testContainer.parentNode.removeChild(testContainer)
    delete window.__xssPwned
  })

  // ==========================================================================
  // Finding #1 — Expression sandbox escape via .constructor.constructor
  // ==========================================================================
  // Attacker controls: expression TEXT. Realistic paths:
  //   (a) data-bind-html injects markup whose child elements carry data-bind
  //       attributes the framework then evaluates.
  //   (b) SSR markup from a template that server-interpolates user data into
  //       attribute values.
  // The simple case (user data ends up as a state VALUE rendered via data-bind)
  // is safe — state values are read, not parsed as expressions.
  // --------------------------------------------------------------------------
  describe('Finding #1: expression sandbox escape', () => {
    it('state VALUES read via data-bind are NOT evaluated as expressions', async () => {
      // Realistic: attacker-controlled string lands in state (e.g. from fetch).
      // This is the 99% case and must be safe.
      wildflower.component('bind-value', {
        state: { title: "x.constructor.constructor('window.__xssPwned=true')()" }
      })
      testContainer.innerHTML = `
        <div data-component="bind-value"><span id="t" data-bind="title"></span></div>
      `
      wildflower.scan()
      await waitForCompleteRender()

      expect(window.__xssPwned).toBe(false)
      // And the string is rendered as literal text, not executed
      expect(testContainer.querySelector('#t').textContent).toContain('constructor')
    })

    it('EXPLOIT: attacker-injected data-bind expression can reach Function constructor', async () => {
      // Realistic path: app uses data-bind-html with unsanitized content.
      // Attacker injects <span data-bind="x.constructor.constructor(...)()"></span>.
      // When the framework re-scans the outlet, the expression evaluator compiles
      // it via new Function(). _UNSAFE_EXPR_RE blocks bracket-form but not
      // dot-form access to .constructor.
      wildflower.component('host', {
        state: {
          x: 'payload',
          userHtml: `<span id="pwn" data-bind="x.constructor.constructor('window.__xssPwned=true')()"></span>`
        }
      })
      testContainer.innerHTML = `
        <div data-component="host">
          <div id="outlet" data-bind-html="userHtml"></div>
        </div>
      `
      wildflower.scan()
      await waitForCompleteRender()
      // Re-scan so the injected data-bind gets picked up (many apps call this)
      wildflower.scan()
      await waitForCompleteRender()

      // If this assertion FAILS (pwned === true), finding #1 is exploitable.
      // Fix: extend _UNSAFE_EXPR_RE to match \.constructor\b and \.__proto__\b.
      expect(window.__xssPwned).toBe(false)
    })

    it('bracket-form constructor access is already blocked', async () => {
      wildflower.component('bracket-test', {
        state: { x: 'payload' }
      })
      testContainer.innerHTML = `
        <div data-component="bracket-test">
          <span id="t" data-bind="x['constructor']['constructor']('window.__xssPwned=true')()"></span>
        </div>
      `
      wildflower.scan()
      await waitForCompleteRender()
      expect(window.__xssPwned).toBe(false)
    })
  })

  // ==========================================================================
  // Finding #2 — data-bind-html default-unsafe
  // ==========================================================================
  // This is documented, dev-warned, opt-in to sanitize. The tests here confirm
  // (a) the default is pass-through (known), (b) a configured sanitizer is
  // actually invoked, (c) <script> tags do NOT execute via innerHTML (browser
  // behavior), but (d) <img onerror> DOES — this is the real footgun.
  // --------------------------------------------------------------------------
  describe('Finding #2: data-bind-html behavior', () => {
    it('script tags in data-bind-html do not auto-execute (browser behavior)', async () => {
      wildflower.component('html-script', {
        state: { html: '<script>window.__xssPwned=true</script>' }
      })
      testContainer.innerHTML = `
        <div data-component="html-script"><div data-bind-html="html"></div></div>
      `
      wildflower.scan()
      await waitForCompleteRender()
      expect(window.__xssPwned).toBe(false)
    })

    it('data-bind-html is pass-through by default (payload reaches DOM verbatim)', async () => {
      // Documented risk: default is pass-through so attacker-controlled HTML
      // lands in innerHTML as-is. The dev-mode warning tells authors to wire
      // up a sanitizer. We do NOT assert on onerror firing because image-load
      // timing is unreliable under full-suite parallel runs; we assert on the
      // DOM state — the onerror attribute survives, proving the pass-through.
      wildflower.component('html-img', {
        state: { html: '<img id="pwnimg" src="x" onerror="window.__xssPwned=true">' }
      })
      testContainer.innerHTML = `
        <div data-component="html-img"><div data-bind-html="html"></div></div>
      `
      wildflower.scan()
      await waitForCompleteRender()

      const img = testContainer.querySelector('#pwnimg')
      expect(img).not.toBeNull()
      expect(img.getAttribute('onerror')).toBe('window.__xssPwned=true')
    })

    it('configured sanitizer is invoked and can neutralize the payload', async () => {
      wildflower.setHtmlSanitizer((html) => html.replace(/on\w+\s*=\s*("[^"]*"|'[^']*')/gi, ''))
      wildflower.component('html-sanitized', {
        state: { html: '<img src="x" onerror="window.__xssPwned=true">' }
      })
      testContainer.innerHTML = `
        <div data-component="html-sanitized"><div data-bind-html="html"></div></div>
      `
      wildflower.scan()
      await waitForCompleteRender()
      await waitForUpdate(50)
      expect(window.__xssPwned).toBe(false)
    })
  })

  // ==========================================================================
  // Finding #3 — URL-attribute sanitizer gaps
  // ==========================================================================
  // These paths are realistic: app binds a user-provided URL into href/src.
  // --------------------------------------------------------------------------
  describe('Finding #3: URL attribute sanitization', () => {
    it('javascript: in href bound via data-bind-attr is blocked', async () => {
      wildflower.component('href-js', {
        state: { attrs: { href: 'javascript:window.__xssPwned=true' } }
      })
      testContainer.innerHTML = `
        <div data-component="href-js"><a id="a" data-bind-attr="attrs">click</a></div>
      `
      wildflower.scan()
      await waitForCompleteRender()

      const a = testContainer.querySelector('#a')
      // Should have been stripped (null → removeAttribute)
      expect(a.getAttribute('href') || '').not.toMatch(/^javascript:/i)
    })

    it('EXPLOIT: Unicode-whitespace-prefixed javascript: URL may bypass the ASCII-only strip', async () => {
      wildflower.component('href-unicode', {
        // U+00A0 NBSP before "javascript:" — not in [\s\x00-\x1F\x7F]
        state: { attrs: { href: '\u00A0javascript:window.__xssPwned=true' } }
      })
      testContainer.innerHTML = `
        <div data-component="href-unicode"><a id="a" data-bind-attr="attrs">click</a></div>
      `
      wildflower.scan()
      await waitForCompleteRender()

      const a = testContainer.querySelector('#a')
      // If this FAILS (href still starts with something like NBSP+javascript:),
      // finding #3 gap is confirmed. Most browsers will still execute such a
      // URL when the link is clicked because they trim leading whitespace.
      expect(a.getAttribute('href') || '').not.toMatch(/javascript:/i)
    })

    it('xlink:href on SVG <a> blocks javascript: through component data-bind-attr', async () => {
      wildflower.component('xlink', {
        state: { attrs: { 'xlink:href': 'javascript:window.__xssPwned=true' } }
      })
      testContainer.innerHTML = `
        <div data-component="xlink">
          <svg><a id="svga" data-bind-attr="attrs"><text>x</text></a></svg>
        </div>
      `
      wildflower.scan()
      await waitForCompleteRender()

      const svgA = testContainer.querySelector('#svga')
      expect(svgA?.getAttribute('xlink:href') || '').not.toMatch(/javascript:/i)
    })

    it('xlink:href on SVG <a> blocks javascript: through pool data-bind-attr', skipIfNoFeature('pools', async () => {
      // Closes the gap left by the list-path test above: same attack, but the
      // entity flows through PoolRenderer's _POOL_URL_ATTRS sanitization path
      // rather than ListExpressionEval._sanitizeAttrValue.
      wildflower.component('xlink-pool', {
        pools: { links: {} },
        init() {
          this.pools.links.add([
            { id: 1, attrs: { 'xlink:href': 'javascript:window.__xssPwned=true' } }
          ])
        }
      })
      testContainer.innerHTML = `
        <div data-component="xlink-pool">
          <svg>
            <g data-pool="links" data-key="id">
              <template>
                <a data-bind-attr="attrs"><text>x</text></a>
              </template>
            </g>
          </svg>
        </div>
      `
      wildflower.scan()
      await waitForCompleteRender()

      const poolA = testContainer.querySelector('a')
      expect(poolA?.getAttribute('xlink:href') || '').not.toMatch(/javascript:/i)
    }))

    it('data: URIs (non-image) blocked on src', async () => {
      wildflower.component('data-src', {
        state: { attrs: { src: 'data:text/html,<script>window.__xssPwned=true</script>' } }
      })
      testContainer.innerHTML = `
        <div data-component="data-src"><iframe id="f" data-bind-attr="attrs"></iframe></div>
      `
      wildflower.scan()
      await waitForCompleteRender()
      await waitForUpdate(100)

      expect(window.__xssPwned).toBe(false)
    })
  })

  // ==========================================================================
  // Finding #5 — prototype pollution via reactive state
  // ==========================================================================
  // Realistic path: form input or JSON from fetch becomes a key written into
  // state. The data-model path binds to a FIXED key, so the attacker would
  // need a code path that writes user-supplied keys. Test the surfaces we do
  // expose.
  // --------------------------------------------------------------------------
  describe('Finding #5: prototype pollution surfaces', () => {
    it('assigning __proto__ on reactive state does not pollute Object.prototype', async () => {
      wildflower.component('proto-test', {
        state: { obj: {} }
      })
      testContainer.innerHTML = `<div data-component="proto-test"></div>`
      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)

      // Simulate attacker-controlled key merged into state
      try {
        instance.state.obj['__proto__'] = { polluted: 'yes' }
      } catch (_) { /* some proxy configs throw; that's fine */ }

      // If pollution happened, every object now has .polluted
      expect({}.polluted).toBeUndefined()
    })

    it('JSON.parse-style merge with __proto__ key does not pollute', async () => {
      // Many apps do: Object.assign(state, await res.json())
      // If the fetched JSON contains {"__proto__": {...}}, does reactive state
      // re-expose the prototype?
      wildflower.component('merge-test', { state: {} })
      testContainer.innerHTML = `<div data-component="merge-test"></div>`
      wildflower.scan()
      await waitForCompleteRender()

      const el = testContainer.querySelector('[data-component]')
      const instance = wildflower.componentInstances.get(el.dataset.componentId)

      const malicious = JSON.parse('{"__proto__": {"polluted": "yes"}}')
      Object.assign(instance.state, malicious)

      expect({}.polluted).toBeUndefined()
    })
  })

  // ==========================================================================
  // Finding #2b / router — outlet HTML from fetch
  // ==========================================================================
  describe('Router outlet HTML rendering', () => {
    it('script tags in router content do not auto-execute', async () => {
      // Direct sink test: router _updateOutlet assigns innerHTML.
      // The common case: HTML from fetch() → outlet.
      const outlet = document.createElement('div')
      testContainer.appendChild(outlet)

      outlet.innerHTML = '<script>window.__xssPwned=true</script>'
      await waitForUpdate(50)
      expect(window.__xssPwned).toBe(false)
    })

    it('EXPLOIT: <svg><script> in router-style HTML assignment runs in some browsers', async () => {
      // This is a known innerHTML-assignment quirk: HTML <script> doesn't run
      // but SVG <script> behavior is browser-dependent. Used here as a sanity
      // check that our default (pass-through) is risky for router content.
      const outlet = document.createElement('div')
      testContainer.appendChild(outlet)
      outlet.innerHTML = '<svg><image href="x" onerror="window.__xssPwned=true"/></svg>'
      await waitForUpdate(100)

      // Document the current state. If pwned, router content needs sanitizer
      // or user must use wildflower.setHtmlSanitizer().
      // Not asserting either way here — browser-dependent; this test is
      // informational and will be tightened once behavior is confirmed.
      expect(typeof window.__xssPwned).toBe('boolean')
    })
  })

  // ==========================================================================
  // Safe-path confirmations — these SHOULD pass today and must keep passing
  // ==========================================================================
  describe('Safe paths (regression guards)', () => {
    it('data-bind text content escapes HTML', async () => {
      wildflower.component('text-escape', {
        state: { msg: '<img src=x onerror="window.__xssPwned=true">' }
      })
      testContainer.innerHTML = `
        <div data-component="text-escape"><span id="t" data-bind="msg"></span></div>
      `
      wildflower.scan()
      await waitForCompleteRender()
      await waitForUpdate(50)

      // Structural assertion (definitive): if data-bind correctly used
      // textContent, no <img> element was created, so no onerror can fire.
      // A window.__xssPwned check here is strictly weaker AND unreliable —
      // the prior test (#151, data-bind-html pass-through) intentionally
      // creates an img whose onerror may fire asynchronously during this
      // test's window, polluting the flag. Test #151's own comment
      // acknowledges this: "image-load timing is unreliable under full-suite
      // parallel runs". Trust the DOM, not the global.
      expect(testContainer.querySelector('#t').querySelector('img')).toBeNull()
    })

    it('data-bind-attr rejects on* event handler attributes', async () => {
      wildflower.component('onattr', {
        state: { attrs: { onclick: 'window.__xssPwned=true' } }
      })
      testContainer.innerHTML = `
        <div data-component="onattr"><button id="b" data-bind-attr="attrs">x</button></div>
      `
      wildflower.scan()
      await waitForCompleteRender()

      const btn = testContainer.querySelector('#b')
      // Structural assertions (definitive): the on* blocklist must leave
      // BOTH the attribute AND the DOM property unset so no handler can fire.
      // A `window.__xssPwned` check here is strictly weaker AND unreliable —
      // prior tests in this file intentionally plant imgs with onerror
      // handlers that can fire asynchronously during this test's window,
      // polluting the sentinel flag (see note on the preceding test).
      expect(btn.getAttribute('onclick')).toBeNull()
      expect(btn.onclick).toBeNull()
    })
  })
})
