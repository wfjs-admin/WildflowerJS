/**
 * Subscribe Wait: stores registered later in the document
 *
 * Companion to subscribe-wait.test.js, which covers a store that EXISTS but is
 * not yet ready. This file covers the other case: a store that has not been
 * registered at all when the component mounts, because the <script> that
 * registers it appears later in the document.
 *
 * That ordering is normal in two situations:
 *   - a streamed/chunked response, where a later chunk carries the store
 *   - any page where the framework scans during parse rather than after it
 *
 * In both, "the store is not in the registry yet" means "not yet", not "never".
 * Resolving it as a permanent miss initialises the component against a store
 * that is about to exist, and the component never recovers.
 *
 * The document's loading state is the discriminator. While the document is
 * still parsing, more stores may still arrive. Once it has finished, a store
 * that is absent is genuinely absent and must fail fast so a typo in a store
 * name does not stall init for the whole subscribeTimeout.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Subscribe Wait: late store registration', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        wildflower = await loadFramework();
    });

    beforeEach(() => {
        resetFramework(wildflower);

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);

        if (wildflower.config) {
            wildflower.config({ subscribeTimeout: 5000 });
        }
    });

    afterEach(() => {
        // Remove the readyState shadow if a test installed one. The own property
        // shadows Document.prototype's getter; deleting it restores the real one.
        if (Object.prototype.hasOwnProperty.call(document, 'readyState')) {
            delete document.readyState;
        }

        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }

        if (wildflower.destroyStore) {
            wildflower.destroyStore('late-store');
            wildflower.destroyStore('never-store');
        }

        if (wildflower.clearComponentDefinitions) {
            wildflower.clearComponentDefinitions();
        }
    });

    /** Make document.readyState report that the document is still parsing. */
    function simulateDocumentParsing() {
        Object.defineProperty(document, 'readyState', {
            configurable: true,
            get: () => 'loading'
        });
    }

    it('waits for a store registered later while the document is still parsing', async () => {
        simulateDocumentParsing();

        let storeAtInit = 'INIT-NOT-CALLED';

        wildflower.component('late-store-comp', {
            subscribe: ['late-store'],
            subscribeTimeout: 3000,
            init() {
                const store = this.stores['late-store'];
                storeAtInit = store ? store.mode : 'MISSING';
            }
        });

        testContainer.innerHTML = '<div data-component="late-store-comp"></div>';
        wildflower._scanForDynamicComponents();

        // The store has not arrived yet, so init must not have run.
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(storeAtInit).toBe('INIT-NOT-CALLED');

        // A later chunk of the document registers the store.
        wildflower.store('late-store', { state: { mode: 'live' } });

        await new Promise(resolve => setTimeout(resolve, 200));

        // init should now have run, and seen the store.
        expect(storeAtInit).toBe('live');
    });

    it('times out and initialises anyway if the store never arrives', async () => {
        simulateDocumentParsing();

        let initCalled = false;
        let storeAtInit = null;

        wildflower.component('never-arrives-comp', {
            subscribe: ['never-store'],
            subscribeTimeout: 200,
            init() {
                initCalled = true;
                storeAtInit = this.stores['never-store'] || null;
            },
            onError() {
                return true;
            }
        });

        testContainer.innerHTML = '<div data-component="never-arrives-comp"></div>';
        wildflower._scanForDynamicComponents();

        await new Promise(resolve => setTimeout(resolve, 500));

        // Best-effort init still happens after the timeout expires.
        expect(initCalled).toBe(true);
        expect(storeAtInit).toBe(null);
    });

    it('subscribeTimeout: 0 with a missing store fails fast at document-complete instead of hanging', async () => {
        // "Wait indefinitely" is the contract for a store that EXISTS and is
        // becoming ready. A store that never registers must still fail fast
        // once the document has finished loading — otherwise a typo'd store
        // name with subscribeTimeout: 0 hangs init forever and leaks the
        // 50ms poll interval.
        //
        // Shadow readyState as 'loading' at mount so the wait path engages,
        // then flip it to 'complete' to simulate the page finishing. The poll
        // must notice and resolve not_found rather than waiting for a
        // timeout that will never fire.
        simulateDocumentParsing();

        let initCalled = false;
        let sawError = null;

        wildflower.component('timeout-zero-comp', {
            subscribe: ['never-store'],
            subscribeTimeout: 0,
            init() {
                initCalled = true;
            },
            onError(error) {
                sawError = error;
                return true;
            }
        });

        testContainer.innerHTML = '<div data-component="timeout-zero-comp"></div>';
        wildflower._scanForDynamicComponents();

        // Document still "parsing": the wait must be holding init.
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(initCalled).toBe(false);

        // The page finishes loading; the store never arrived.
        delete document.readyState;
        expect(document.readyState).toBe('complete');

        // The 50ms poll should detect completion and fail fast.
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(initCalled).toBe(true);
        expect(sawError).toBeTruthy();
        expect(sawError.type).toBe('subscribe_store_not_found');
    });

    it('does not stall init for a missing store once the document has loaded', async () => {
        // No readyState shadow here: the document is 'complete', as it is for any
        // component mounted after page load. A store that is missing now is
        // genuinely missing, so init must not wait out the full timeout.
        let initElapsed = -1;
        const start = Date.now();

        wildflower.component('missing-after-load-comp', {
            subscribe: ['never-store'],
            subscribeTimeout: 5000,
            init() {
                initElapsed = Date.now() - start;
            },
            onError() {
                return true;
            }
        });

        testContainer.innerHTML = '<div data-component="missing-after-load-comp"></div>';
        wildflower._scanForDynamicComponents();

        await new Promise(resolve => setTimeout(resolve, 200));

        expect(initElapsed).toBeGreaterThanOrEqual(0);
        expect(initElapsed).toBeLessThan(200);
    });
});
