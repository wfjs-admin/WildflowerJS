/**
 * State fields named `id` and `name`, the columns every server record has (an
 * edit form's { id, name, email }). State wins for both: `this.id` reads and
 * writes the state's id, as `data-bind="id"` does, and neither name draws the
 * dev-build collision warning, which stays for names state cannot take. A
 * component without an `id` in state still reads its own id as `this.id`,
 * and one with it still tracks the stores and components its computeds read.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadFramework, resetFramework, isMinifiedBuild } from './helpers/load-framework.js';

describe('state fields named id and name', () => {
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
        if (container && container.parentNode) container.parentNode.removeChild(container);
        vi.restoreAllMocks();
    });

    const settle = () => new Promise(resolve => setTimeout(resolve, 50));
    const collisions = (warn) => warn.mock.calls.map(c => String(c[0])).filter(s => s.includes('collides with a framework property'));

    it('this.id and this.name read and write the state, as the bindings do', async () => {
        const seen = {};
        wf.component('sin-form', {
            state: { id: 42, name: 'Ann' },
            init() { seen.id = this.id; seen.name = this.name; },
            bump() { this.id = 43; this.name = 'Ben'; },
        });
        container.innerHTML = `
            <form data-component="sin-form">
                <span id="sin-id" data-bind="id"></span>
                <span id="sin-name" data-bind="name"></span>
                <button id="sin-bump" type="button" data-action="bump">bump</button>
            </form>`;
        wf.scan();
        await settle();
        expect(seen).toEqual({ id: 42, name: 'Ann' });
        expect(container.querySelector('#sin-id').textContent).toBe('42');
        container.querySelector('#sin-bump').click();
        await settle();
        expect(container.querySelector('#sin-id').textContent).toBe('43');
        expect(container.querySelector('#sin-name').textContent).toBe('Ben');
        expect(wf.getComponent('sin-form').state.id).toBe(43);
    });

    // The collision warning is development-only.
    it.skipIf(isMinifiedBuild())('does not warn for id or name, and still warns for a name state cannot take', async () => {
        const warn = vi.spyOn(console, 'warn');
        wf.component('sin-quiet', { state: { id: 1, name: 'x', parent: null, reset: false } });
        wf.component('sin-loud', { state: { element: 'x' } });
        container.innerHTML = `<div data-component="sin-quiet"></div><div data-component="sin-loud"></div>`;
        wf.scan();
        await settle();
        const found = collisions(warn);
        expect(found.filter(s => s.includes('"sin-quiet"'))).toEqual([]);
        expect(found.some(s => s.includes('"sin-loud"') && s.includes('"element"'))).toBe(true);
    });

    it('a component without an id in state reads its own id', async () => {
        let own;
        wf.component('sin-plain', { state: { n: 1 }, init() { own = this.id; } });
        container.innerHTML = `<div data-component="sin-plain"></div>`;
        wf.scan();
        await settle();
        expect(own).toBe(container.querySelector('[data-component="sin-plain"]').dataset.componentId);
    });

    it('a component with an id in state still follows the store and component its computeds read', async () => {
        wf.store('sin-store', { state: { count: 1 } });
        wf.component('sin-source', { state: { level: 'low' } });
        wf.component('sin-reader', {
            state: { id: 7 },
            computed: {
                fromStore() { return this.getStore('sin-store').count; },
                fromExternal() { return this.external('sin-source', 'level'); },
            },
        });
        container.innerHTML = `
            <div data-component="sin-source"></div>
            <div data-component="sin-reader">
                <span id="sin-store" data-bind="fromStore"></span>
                <span id="sin-ext" data-bind="fromExternal"></span>
            </div>`;
        wf.scan();
        await settle();
        expect(container.querySelector('#sin-store').textContent).toBe('1');
        expect(container.querySelector('#sin-ext').textContent).toBe('low');
        wf.getStore('sin-store').count = 2;
        wf.getComponent('sin-source').level = 'high';
        await settle();
        expect(container.querySelector('#sin-store').textContent).toBe('2');
        expect(container.querySelector('#sin-ext').textContent).toBe('high');
    });
});
