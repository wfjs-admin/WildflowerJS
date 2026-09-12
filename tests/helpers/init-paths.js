/**
 * Dual init-path helper.
 *
 * WildflowerJS initializes components through two orchestrators, and the whole
 * test suite historically drove only the first:
 *
 *   incremental — _initializeComponentElement, used by wildflower.scan(), the
 *                 MutationObserver, and nested-component init.
 *   pageLoad    — the batched orchestrator (_scanForComponents ->
 *                 _setupSingleInstanceComputed / _setupSingleInstanceFeatures)
 *                 that the bootstrap runs on real page load.
 *
 * Two real divergences shipped because no test drove the second path (a missing
 * pool-reference injection, and a missing markup-portal pass). Run the same
 * scenario through both entries to catch any future drift:
 *
 *   describe.each(Object.entries(INIT_PATHS))('via %s path', (name, run) => {
 *     it('...', async () => { container.innerHTML = ...; run(wildflower); await settle(); ... })
 *   })
 *
 * Caveat: `pageLoad` uses the SYNC orchestrator (_scanForComponents). Real page
 * load uses the async _scanForComponentsAsync, but both share the per-instance
 * unit-of-work functions where divergences live, so this is a faithful proxy for
 * the "a setup step is missing on one path" bug class. Async-sequencing-only bugs
 * need real-page fixtures, which this suite does not include.
 *
 * Each entry scans the document root (like a real page load), so tests must place
 * their component in the document and clean it up afterward.
 */
export const INIT_PATHS = {
    incremental: (wf) => wf.scan(),
    pageLoad: (wf) => wf._scanForComponents(),
};
