# Changelog

All notable changes to WildflowerJS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Per-entry detail lives at <https://www.wildflowerjs.com/changelog.html>.** Each entry below links to the full prose description on the website. Breaking changes are kept in full here so they are visible at upgrade time without leaving the package.


## [1.1.0] - 2026-05-18

### Build & Toolchain
- [Vendored, npm-free build pipeline](https://www.wildflowerjs.com/changelog.html#vendored-npm-free-build-pipeline): rollup + terser fetched as SHA-512-pinned tarballs; zero `npm install` for the framework build. See [PROVENANCE.md](./PROVENANCE.md) for the layered trust model.

### Added
- [Pool entity model](https://www.wildflowerjs.com/changelog.html#pool-entity-model): pools accept `entity: { state, computed, methods }` matching component shape.
- [Pool array-like API](https://www.wildflowerjs.com/changelog.html#pool-array-like-api): `push`, `pop`, `at(i)`, `find`, `filter`, `map`, etc. on `PoolHandle`.
- [`mini` build variant](https://www.wildflowerjs.com/changelog.html#mini-build-variant): `lite` minus the data-pool renderer; new smallest tier.
- [Pool-level props](https://www.wildflowerjs.com/changelog.html#pool-level-props): parent components inject shared data accessible to all pool entities via the `props.` prefix.
- [Browser DevTools integration](https://www.wildflowerjs.com/changelog.html#browser-devtools-integration): `__WF_DEVTOOLS_GLOBAL_HOOK__` introspection API; companion `@wildflowerjs/devtools` package and MV3 extension.
- [jQuery 3.x and 4.x coexistence verified](https://www.wildflowerjs.com/changelog.html#jquery-coexistence): 34-test matrix locks drop-in safety in WordPress / legacy-CMS pages.
- [Item-level computed properties in binding expressions](https://www.wildflowerjs.com/changelog.html#item-level-computeds-in-bindings): `fn(item)` computeds now resolve in `data-bind`, `data-bind-class`, `data-bind-style`, `data-bind-attr`, `data-show`, and `data-render`, including compound expressions and nested lists.
- [`wildflower.batch(fn)` callback wrapper](https://www.wildflowerjs.com/changelog.html#wildflower-batch-callback): exception-safe batched mutations without manual try/catch.
- [`wildflower.toRaw(value)`](https://www.wildflowerjs.com/changelog.html#wildflower-toraw): deep plain-JS snapshot of any reactive value. Required when WF state crosses a structured-clone boundary (IndexedDB, `postMessage`, Web Workers, BroadcastChannel, Cache API, History state) which would otherwise throw `DataCloneError`.

### Breaking Changes

- **Action handlers no longer stop event propagation by default.** Click events (and other DOM events dispatched via `data-action`) now bubble naturally past the action handler. To opt back in to the v1.0 behavior on a specific element, add `data-event-stop` (e.g., `<button data-action="save" data-event-stop>`). This change makes WildflowerJS coexist cleanly with external delegation systems on the same page, most importantly jQuery's `$(document).on(...)` style delegation, which v1.0 silently consumed events from. Internal nested-component double-fire is still prevented via a per-event marker (`event._wfHandled`) without relying on `stopPropagation`. The v1.0 behavior was undocumented and not on the API surface, so most apps will see no change; if you specifically relied on action handlers stopping the bubble chain (common in modal/dropdown click-outside guards), add `data-event-stop` to the affected elements.
- **Removed `data-model-debounce` attribute**: debouncing user input now belongs on the action that receives it. Migrate any `data-model-debounce="Xms"` usage to the corresponding action with a debounce modifier (`data-action="input.debounce.Xms:handleInput"`). The attribute was experimental and its semantics collided with list re-render timing; routing debounce through the action layer is simpler and avoids the stale-value hazards of capturing state at keydown.
- **Bare-form item-level computeds removed.** The function signature alone declares scope: `fn(item, index, info) { ... }` is item-level (runs per row); `fn() { ... }` is component-level (runs once per component). In v1.0 a zero-arg computed referenced inside a list-template binding was reinterpreted as item-level, with `this.X` resolving to the current row's field. That dual interpretation is removed: zero-arg computeds always evaluate at component scope. A zero-arg computed referenced inside a list-template binding produces the same value for every row. **Migration:** change `fn() { return this.assignee }` (intended as item-level) to `fn(item) { return item.assignee }`. The new `info` third arg gives parameterised forms access to list-context vars: `fn(item, index, info) { if (info.first) ...; if (info.last) ...; const len = info.length; }`. The bare-form pattern had silent failure modes: name shadowing (if state and item shared a field name, item won silently), and scope-dependent semantics (same code returning different values depending on whether it was rendered inside a list or at component scope). The illusory advantage was "shape-polymorphic dual-scope reuse" (one computed serving both group-header and row contexts in nested lists), which parameterised form handles equally well as long as both row shapes share the field the computed reads. v1.0 had no documented item-level computeds (they didn't appear in lists.html, llms.txt, or ai-assistant.html), so user-facing impact is bounded; the only known internal consumer was the project-management demo for v1.1, migrated alongside this change.

### Fixed
- [Item-level computed bindings reactively update on per-row state mutations](https://www.wildflowerjs.com/changelog.html#item-level-computed-targeted-rebind): computed-name bindings no longer get falsely filtered out by the targeted-rebind path-equality check. Covers every targeted-rebind site, including `data-show` via `_executeShows`.
- [Item-level computeds in class binding expressions](https://www.wildflowerjs.com/changelog.html#item-level-computeds-class-bindings): `data-bind-class="isOn ? 'a' : 'b'"` no longer evaluates to `undefined`.
- [Nested `data-list` source resolves item-level computeds](https://www.wildflowerjs.com/changelog.html#nested-list-item-computed-source): inner-list source paths fall back to item-level computeds the way `data-bind` already did.
- [Multi-component scan init race that left nested `data-list` inner items unrendered](https://www.wildflowerjs.com/changelog.html#multi-component-scan-init-race): `_listRelationships` is pre-populated before render-effect firing.
- [Pool entity binding and dispatch issues](https://www.wildflowerjs.com/changelog.html#pool-entity-binding-dispatch): boolean-prop sync, `data-bind` on form inputs, dotted-path bindings.
- [Bindings on `data-list` root elements](https://www.wildflowerjs.com/changelog.html#data-list-root-element-bindings): `data-bind-style`/`-class`/`-attr`/`data-model` on a list root no longer silently skipped.
- [`data-cloak` retained on dynamically-added list items](https://www.wildflowerjs.com/changelog.html#data-cloak-list-template-strip): rows added after the initial scan, or moved between sibling lists, no longer inherit `data-cloak` from the cached template and stay hidden.
- [Hover events on `data-list` row templates](https://www.wildflowerjs.com/changelog.html#list-row-hover-event-delegation): `data-action="mouseenter:..."`, `mouseleave:...`, `mouseover:...`, and `mouseout:...` declarations on elements inside a `data-list` template now wire up correctly through the delegated event system. Closes a gap where hover handlers on list-row children silently did nothing.
- [Multiple actions on a single list-row element](https://www.wildflowerjs.com/changelog.html#list-row-multi-action-dispatch): `data-action="click:open mouseenter:hover mouseleave:unhover"` on an element that's a direct child of a `data-list` template now fires every declared handler. Previously only the first declared action wired up; subsequent ones were silently dropped during per-row context creation.
- [`data-event-outside` on `data-list` row children](https://www.wildflowerjs.com/changelog.html#list-row-event-outside-dispatch): a `data-event-outside` declaration on an element inside a `data-list` template (e.g. an inline-edit popover that should close on outside-click) now wires the document-level outside-click handler. Previously the row context-creation path didn't read the attribute and the regular `_setupActions` path skipped list-row children, so it was a silent no-op.
- [`data-event-outside` row-child handlers receive a `details` object](https://www.wildflowerjs.com/changelog.html#list-row-event-outside-details): outside-click handlers on a `data-list` row child are now called with `(event, el, details)` where `details.item` is the row's data, matching regular row action handlers. Non-list handlers are unaffected.
- [Idempotent attribute writes in list and effect paths](https://www.wildflowerjs.com/changelog.html#idempotent-attribute-writes): fixes `<video>` reload flashes from identical `src` writes during reconciliation.
- [Debounce writeback regression](https://www.wildflowerjs.com/changelog.html#debounce-writeback-regression): stale debounced state no longer overwrites typed input.
- [Binding validator false positives](https://www.wildflowerjs.com/changelog.html#binding-validator-false-positives): dev-mode validator no longer flags `user.name` as unknown when `user` is defined.
- [Pool sub-array `remove()` O(n²) on bulk clear](https://www.wildflowerjs.com/changelog.html#pool-sub-array-remove-on-bulk-clear): constant-time `subIdx`-based removal.
- [ListRenderer fingerprint collisions on arrays between 100 and 1000 items](https://www.wildflowerjs.com/changelog.html#list-fingerprint-collisions): full-item hashing up to 1000; 7-position sampling beyond.
- [SSR state parser for `<input>` / `<textarea>` / `<select>`](https://www.wildflowerjs.com/changelog.html#ssr-state-parser-form-elements): hydration reads `element.value`, not `textContent`.
- [Portaled event listener leaks on component destroy](https://www.wildflowerjs.com/changelog.html#portaled-listener-leaks): listeners on portaled elements explicitly removed before detach.
- [Reactivity correctness in expression cache and sync-effect reentrancy](https://www.wildflowerjs.com/changelog.html#expression-cache-sync-effect-reentrancy): snapshot-before-iterate guard in `_notifyEffectDependents`, plus per-instance `_reusableEffectSet`.
- [Computed properties that delegate to branching helper functions now re-track dependencies on every evaluation](https://www.wildflowerjs.com/changelog.html#computed-branching-helpers-redeptrack): function calls in computed bodies block STATIC-mode promotion.
- [Action handlers fired before `init()` completes are queued and replayed](https://www.wildflowerjs.com/changelog.html#action-handlers-pre-init-queue): events arriving during async `init` no longer drop or throw.
- [Composed computed properties no longer drop dependencies in nested evaluations](https://www.wildflowerjs.com/changelog.html#composed-computeds-nested-deps): dep-tracking buffer saved/restored across nested evaluator calls.
- [Effect cleanup on component destroy walks all three places effects can live](https://www.wildflowerjs.com/changelog.html#effect-cleanup-three-locations): `instance._effects`, `context._effects`, AND `stateManager._effects`.
- [`data-bind-style` and `data-bind-attr` clear keys that drop out of the bound result](https://www.wildflowerjs.com/changelog.html#bind-style-attr-key-dropout): diff against per-element tracking sets and clear dropped keys.
- [`data-bind-class` shape mismatch no longer crashes deep in the framework (WF-505)](https://www.wildflowerjs.com/changelog.html#bind-class-shape-mismatch-WF-505): non-string class values coerce instead of throwing `t.split is not a function`.
- [List click delegation no longer drops row clicks when an ancestor element carries `data-action`](https://www.wildflowerjs.com/changelog.html#list-click-delegation-ancestor-action): metadata fallback retried after out-of-scope `closest()`.
- [Item-level computed properties inside list rows now re-evaluate when an external store/plugin mutates](https://www.wildflowerjs.com/changelog.html#item-level-computed-external-store-mutation): per-item effects woken from `_handleEntityStateChange` via `_listItemEffects`.
- [Dev-mode warning for cross-subtree state proxy aliasing](https://www.wildflowerjs.com/changelog.html#dev-warn-cross-subtree-proxy-aliasing): surfaces aliasing bugs where a nested object is reachable from two unrelated subtrees.
- [Components subscribing via `subscribe: { storeName: ['path'] }` + `onStoreUpdate`](https://www.wildflowerjs.com/changelog.html#subscribe-onstoreupdate-no-read-path): `subscribePath` now invalidates the `_hasNotifyTargets` cache; subscribe-only components no longer silently miss updates.
- [Subscribe-block components are now registered as entity dependents of their store](https://www.wildflowerjs.com/changelog.html#subscribe-block-entity-dep-registration): closes a Chrome-specific cascade gap where `subscribe: { store: ['path'] }` registered only as a path-subscriber, so post-init store mutations called `onStoreUpdate` but never dirtied dependent computeds. The detail-pane on async-hydrated stores (PM demo on Chrome soft reload) stopped updating until an unrelated mutation woke the cascade.
- [LEAN re-eval path now sets `_computedTrackingContext`](https://www.wildflowerjs.com/changelog.html#lean-path-tracking-context): cross-entity computeds re-evaluated through the lean path (after their first full eval) now register cross-store deps via the tracking proxy. Previously the lean path skipped tracking-context setup on the assumption that "external deps are stable after first eval" — but that assumption broke when the first eval early-returned before the cross-store read. Subsequent lean re-evals would never register the missing dep, leaving the computed permanently disconnected from its source store.
- [`_resolvePendingStoreDependencies` now resets `_externalEvalCount` on dependents](https://www.wildflowerjs.com/changelog.html#resolve-pending-store-deps-reset-eval-count): when a late-arriving store resolves and the cache-clear runs, all computed nodes' lean-eval counter is also reset so the next eval takes the full path and re-establishes cross-store dependency tracking cleanly. Without the reset, dependents stayed on the lean path with the pre-resolve dep graph (which usually lacked the just-resolved store).
- [Component-level computeds referenced inside list templates no longer get falsely flagged item-level](https://www.wildflowerjs.com/changelog.html#item-level-marking-scope-fn-length): `_evaluateComputedInListContext` now scopes the item-level marking to `fn.length > 0`, so component-level computeds stay cascade-targets instead of being silently skipped on subsequent state mutations.
- [`_setupStoreSubscriptions` hoisted ahead of computed setup in the scanner](https://www.wildflowerjs.com/changelog.html#scanner-subscribe-before-computed): both sync and async orchestrators register `subscribePath` as a pre-pass before initial computed evaluations enqueue — closes a Firefox-only blank-detail-pane race on soft reload where an async store mutation landed between scanner yields and missed the not-yet-subscribed component.
- [List-row click delegation now bounds `closest()` to the list element](https://www.wildflowerjs.com/changelog.html#list-row-closest-boundary): closes a silent dead-click bug where a row's stripped `data-action` (innerHTML fast-path optimization) caused `closest()` to walk past the empty row and latch onto an unrelated outer ancestor (e.g. a wrapping `<form data-action="submit">`), bailing before the compiled-metadata fallback could fire.
- [Per-row field precedence honoured by `data-bind-style` and `data-bind-class`](https://www.wildflowerjs.com/changelog.html#list-row-field-precedence): in a `data-list` template, `item[expression]` now correctly wins over a same-name component-level computed, matching the documented contract. Companion fix removes a duplicate component-level effect on in-list elements that raced the list-row update path.
- [`wildflower.createRouter()` staged-init pattern no longer emits spurious warnings](https://www.wildflowerjs.com/changelog.html#create-router-staged-init): factory only auto-initializes when `routes:` is provided.
- [`router.navigate(path, { replace: true })` updates the address bar](https://www.wildflowerjs.com/changelog.html#router-navigate-replace): `replace` now performs `history.replaceState` instead of skipping the URL update entirely.
- [`data-cloak` strip for components registered after framework init](https://www.wildflowerjs.com/changelog.html#cloak-strip-late-registered-components): closes a Chrome-only "appear then hide" flash on default-hidden elements inside defer-loaded components.
- [Nested-list and refresh-effect cleanup on list re-render](https://www.wildflowerjs.com/changelog.html#nested-list-dispose-cascade): list re-render now also disposes nested `[data-list]` mapArrays in the subtree and the list's own refresh effect, fixing a per-re-render effect leak that ballooned subsequent state-change cost.

### Performance
- [Cross-store computed cache-hit fast path](https://www.wildflowerjs.com/changelog.html#cross-store-computed-cache-fast-path): cached computed reads skip re-evaluation when source stores are unchanged. 8.7x Firefox / 4x Chrome on the microbenchmark.
- [Portal binding lookup](https://www.wildflowerjs.com/changelog.html#portal-binding-lookup): `_renderPortalBindings` per-component context index replaces O(all-bindings) scan.
- [Reactivity batch change-detection rebuilt around the proxy](https://www.wildflowerjs.com/changelog.html#reactivity-batch-rebuilt): `startBatch` constant-time per batch; ~600 lines of legacy serialization removed; data-pool benchmarks gain `swap1k` ~25% / `remove-one-1k` ~20%.
- [Path-scoped entity invalidation](https://www.wildflowerjs.com/changelog.html#path-scoped-entity-invalidation): a store mutation to a path a subscribing component does not read no longer re-dirties that component's computeds or force-runs its per-item effects. Cross-entity invalidation matches the changed path (prefix-aware) against declared `subscribe` paths and runtime-tracked dependencies; unmatched dependents are skipped.
- [Portal visibility update skipped for portal-free components](https://www.wildflowerjs.com/changelog.html#portal-visibility-skip-portal-free): cached `_hasPortals` flag avoids a descendant `querySelectorAll` per entity state change on subtrees that have no portals.
- [Class-binding eager item-computed eval gated on merged-context need](https://www.wildflowerjs.com/changelog.html#class-binding-eager-eval-gate): `_applyClassBindingsToRow` skips eager evaluation of all item-level computeds when no class evaluator needs the merged context, eliminating 2 Proxy allocations per computed per row per update on simple-property bindings.

### Security
- [`xlink:href` sanitizer coverage](https://www.wildflowerjs.com/changelog.html#xlink-href-sanitizer): adds `xlink:href` to the URL-attribute allow-list, blocking `javascript:` URIs on SVG `<a>`/`<use>`.
- [Narrowed `data:image/` allowlist to raster formats only](https://www.wildflowerjs.com/changelog.html#data-image-allowlist-raster-only): `data:image/svg+xml` blocked; raster subtypes (`png`, `jpe?g`, `gif`, `webp`, `avif`, `bmp`, `ico`, `tiff?`, `x-icon`) allowed.

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
