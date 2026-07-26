/**
 * Props refresh on store-driven computed change — the "unwatched computed"
 * seal (sweep half).
 *
 * The stale-workaround finding (probed 2026-07-16/17, session
 * purple-square-41): store -> parent computed -> child prop went stale, and
 * the computed was INNOCENT. After a store write, the parent's computed reads
 * fresh and the parent's own bound computed repaints; only the child's
 * _propsData snapshot stayed stale. Cause: a store change sweeps the
 * DEPENDENT's own props (EntitySystem dependents branch), and a parent STATE
 * change sweeps the parent's CHILDREN's props (isComponent branch), but a
 * store-driven computed change never swept the dependent's children.
 *
 * The fix routes the dependents branch through the same per-child refresh the
 * isComponent branch uses. This is also what makes the passthrough-computed
 * pattern (the documented alternative to $ in props) actually live.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('Props refresh on store-driven computed change', () => {
    let container;
    let wf;

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
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    const waitForInit = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

    const childInstance = (sel) => {
        const el = container.querySelector(sel);
        return wf.componentInstances.get(el.dataset.componentId);
    };

    it('store write flows through a parent computed into the child prop', async () => {
        wf.store('prs-store', { state: { val: 'S0' } });
        wf.component('prs-child', { props: { incoming: {} } });
        wf.component('prs-parent', {
            subscribe: ['prs-store'],
            state: { unused: 1 },
            computed: { fromStore() { return this.stores['prs-store'].val; } }
        });
        container.innerHTML = `
            <div data-component="prs-parent">
                <span id="bound" data-bind="fromStore"></span>
                <div id="c" data-component="prs-child" data-prop-incoming="fromStore"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('#c').props.incoming).toBe('S0');

        wf.getStore('prs-store').val = 'S1';
        await waitForInit(120);

        // Parent's own binding was always live — pinned so the sweep change
        // can't regress it.
        expect(container.querySelector('#bound').textContent.trim()).toBe('S1');
        // The child prop is the fix: previously frozen at S0.
        expect(childInstance('#c').props.incoming).toBe('S1');
    });

    it('child render output tracks the refreshed prop', async () => {
        wf.store('prs-store2', { state: { val: 'before' } });
        wf.component('prs-child2', {
            props: { incoming: {} },
            computed: { shown() { return 'v:' + this.props.incoming; } }
        });
        wf.component('prs-parent2', {
            subscribe: ['prs-store2'],
            state: { unused: 1 },
            computed: { fromStore() { return this.stores['prs-store2'].val; } }
        });
        container.innerHTML = `
            <div data-component="prs-parent2">
                <div id="c2" data-component="prs-child2" data-prop-incoming="fromStore">
                    <span id="c2out" data-bind="shown"></span>
                </div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(container.querySelector('#c2out').textContent.trim()).toBe('v:before');

        wf.getStore('prs-store2').val = 'after';
        await waitForInit(120);
        expect(container.querySelector('#c2out').textContent.trim()).toBe('v:after');
    });

    it('REGRESSION GUARD: parent-state-driven child prop refresh still works', async () => {
        wf.component('prs-child3', { props: { incoming: {} } });
        wf.component('prs-parent3', {
            state: { localVal: 'L0' },
        });
        container.innerHTML = `
            <div data-component="prs-parent3">
                <div id="c3" data-component="prs-child3" data-prop-incoming="localVal"></div>
            </div>
        `;
        wf.scan();
        await waitForInit();
        expect(childInstance('#c3').props.incoming).toBe('L0');
        wf.getComponentsByType('prs-parent3')[0].context.localVal = 'L1';
        await waitForInit(120);
        expect(childInstance('#c3').props.incoming).toBe('L1');
    });
});
