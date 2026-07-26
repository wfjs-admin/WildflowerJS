/**
 * $entity.path in props — SUPPORTED.
 *
 * data-prop-* / data-props values of the form "$entity.path" resolve through the
 * parent's external() — the same accessor every other read binding compiles $
 * shorthands into — so props get the full external contract: stores, components,
 * late binding, dependency registration. Because instance.props re-resolves per
 * access, the prop is live-on-read against the target's CURRENT state.
 *
 * History (session purple-square-41): this was previously a silent gap — `$` is a
 * legal JS identifier start, so "$probe.val" was looked up as a parent state key,
 * missed, and yielded undefined exactly like a typo. A WF-506 diagnostic shipped
 * for one session and was replaced by support the same day (Chris: "we need to
 * support $ in props"). The probes also established that the passthrough-computed
 * workaround could serve a STALE value (computed never read under an observer
 * tracks nothing and never invalidates), so the direct form is not just shorter —
 * it is more correct.
 *
 * The literal test pins the regex boundary: entity names can't start with a
 * digit, so "$5.00" / "Price: $5.00" stay string literals.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('$entity.path in props', () => {
    let container;
    let wf;
    let warnings;
    let originalWarn;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        wf = window.wildflower;
        resetFramework();
        if (wf._initContextSystem) {
            wf._contextSystemInitialized = false;
            wf._initContextSystem();
        }
        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
        warnings = [];
        originalWarn = console.warn;
        console.warn = (...args) => {
            warnings.push(args.map(a => (a && a.nodeType) ? '<el>' : String(a)).join(' '));
            // keep the original noisy path silent in test output
        };
    });

    afterEach(() => {
        console.warn = originalWarn;
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    const waitForInit = () => new Promise(resolve => setTimeout(resolve, 50));

    const childInstance = (sel) => {
        const el = container.querySelector(sel);
        return wf.componentInstances.get(el.dataset.componentId);
    };

    function registerChild() {
        wf.component('shorthand-child', {
            props: { incoming: {} }
        });
    }

    it('resolves $store.path in data-prop-*', async () => {
        wf.store('sh-store', { state: { val: 'STORE-OK' } });
        registerChild();
        wf.component('shorthand-parent', { state: { unrelated: 1 } });
        container.innerHTML = `
            <div data-component="shorthand-parent">
                <div data-component="shorthand-child" data-prop-incoming="$sh-store.val"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('[data-component="shorthand-child"]').props.incoming).toBe('STORE-OK');
    });

    it('resolves $store.path in the data-props object form (shared resolver)', async () => {
        wf.store('sh-store', { state: { val: 'STORE-OK' } });
        registerChild();
        wf.component('shorthand-parent', { state: { unrelated: 1 } });
        container.innerHTML = `
            <div data-component="shorthand-parent">
                <div data-component="shorthand-child" data-props="{ incoming: $sh-store.val }"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('[data-component="shorthand-child"]').props.incoming).toBe('STORE-OK');
    });

    // Stores survive resetFramework() and re-registration of an existing name is
    // a no-op, so every test uses a UNIQUE store name. Reusing one silently hands
    // later tests the first test's store (this suite's first red run proved it).
    it('resolves a dotted path into nested store state', async () => {
        wf.store('sh-nested', { state: { user: { profile: { name: 'Nested-OK' } } } });
        registerChild();
        wf.component('shorthand-parent', { state: { unrelated: 1 } });
        container.innerHTML = `
            <div data-component="shorthand-parent">
                <div data-component="shorthand-child" data-prop-incoming="$sh-nested.user.profile.name"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('[data-component="shorthand-child"]').props.incoming).toBe('Nested-OK');
    });

    it('is live-on-read: a store write is visible on the next props access', async () => {
        wf.store('sh-live', { state: { val: 'BEFORE' } });
        registerChild();
        wf.component('shorthand-parent', { state: { unrelated: 1 } });
        container.innerHTML = `
            <div data-component="shorthand-parent">
                <div data-component="shorthand-child" data-prop-incoming="$sh-live.val"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        const child = childInstance('[data-component="shorthand-child"]');
        expect(child.props.incoming).toBe('BEFORE');
        wf.getStore('sh-live').val = 'AFTER';
        await waitForInit();
        expect(child.props.incoming).toBe('AFTER');
    });

    it('reaches a COMPONENT, not just stores ($ is general out-reach)', async () => {
        wf.component('sh-donor', { state: { donorVal: 'COMPONENT-OK' } });
        registerChild();
        wf.component('shorthand-parent', { state: { unrelated: 1 } });
        container.innerHTML = `
            <div data-component="sh-donor"></div>
            <div data-component="shorthand-parent">
                <div data-component="shorthand-child" data-prop-incoming="$sh-donor.donorVal"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('[data-component="shorthand-child"]').props.incoming).toBe('COMPONENT-OK');
    });

    it('leaves $-containing literals alone ("Price: $5.00" is not a shorthand)', async () => {
        registerChild();
        wf.component('shorthand-parent', { state: { unrelated: 1 } });
        container.innerHTML = `
            <div data-component="shorthand-parent">
                <div data-component="shorthand-child" data-prop-incoming="Price: $5.00"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('[data-component="shorthand-child"]').props.incoming).toBe('Price: $5.00');
    });

    it('does not disturb in-scope resolution (state and computed still win their forms)', async () => {
        registerChild();
        wf.component('shorthand-parent', {
            state: { localVal: 'LOCAL', n: 21 },
            computed: { doubled() { return this.n * 2; } }
        });
        container.innerHTML = `
            <div data-component="shorthand-parent">
                <div id="c1" data-component="shorthand-child" data-prop-incoming="localVal"></div>
                <div id="c2" data-component="shorthand-child" data-prop-incoming="doubled"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('#c1').props.incoming).toBe('LOCAL');
        expect(childInstance('#c2').props.incoming).toBe(42);
    });

    it('emits no WF warnings for any of the supported forms', async () => {
        wf.store('sh-store', { state: { val: 'STORE-OK' } });
        registerChild();
        wf.component('shorthand-parent', { state: { unrelated: 1 } });
        container.innerHTML = `
            <div data-component="shorthand-parent">
                <div data-component="shorthand-child" data-prop-incoming="$sh-store.val"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        const wfWarnings = warnings.filter(w => /^\[WF/.test(w));
        expect(wfWarnings).toEqual([]);
    });
});
