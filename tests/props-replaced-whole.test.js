/**
 * Props replaced whole, as a page router would use them: the page's props
 * held in an outlet component's state, mapped into the page with data-props, replaced
 * whole on each visit. Three cases, each pinned here:
 *
 *   1. A top-level component's JSON data-props: an array or object value
 *      arrives as itself, not as a string.
 *   2. data-list over a prop re-renders when the parent replaces the array.
 *   3. A $store.path prop repaints the child's bindings when the store
 *      changes.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('props replaced whole on each visit', () => {
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
    });

    const settle = () => new Promise(resolve => setTimeout(resolve, 50));
    const instanceOf = (sel) => wf.componentInstances.get(container.querySelector(sel).dataset.componentId);

    it("a top-level component's JSON data-props keeps an array as an array and an object as an object", async () => {
        wf.component('pif-page', { props: { users: {}, meta: {} } });
        container.innerHTML = `<div data-component="pif-page" data-props='{"users":[{"name":"ann"},{"name":"bo"}],"meta":{"n":1}}'></div>`;
        wf.scan();
        await settle();
        const page = instanceOf('[data-component="pif-page"]');
        expect(Array.isArray(page.props.users)).toBe(true);
        expect(page.props.users.length).toBe(2);
        expect(page.props.users[1].name).toBe('bo');
        expect(page.props.meta).toEqual({ n: 1 });
    });

    it('data-list over a prop re-renders when the parent replaces the array', async () => {
        wf.component('pif-outlet', { state: { users: [{ id: 1, name: 'ann' }] } });
        wf.component('pif-list', { props: { users: {} } });
        container.innerHTML = `
            <div data-component="pif-outlet">
                <div data-component="pif-list" data-props="{ users: users }">
                    <ul data-list="props.users" data-key="id"><template><li data-bind="name"></li></template></ul>
                </div>
            </div>`;
        wf.scan();
        await settle();
        const names = () => Array.from(container.querySelectorAll('li')).map((li) => li.textContent);
        expect(names()).toEqual(['ann']);
        // A visit hands the outlet a new array.
        instanceOf('[data-component="pif-outlet"]').state.users = [{ id: 2, name: 'bo' }, { id: 3, name: 'cy' }, { id: 4, name: 'di' }];
        await settle();
        expect(names()).toEqual(['bo', 'cy', 'di']);
    });

    it('a $store.path prop repaints the child when the store changes', async () => {
        wf.store('pif-page-store', { state: { title: 'First' } });
        wf.component('pif-wrap', { state: { unrelated: 1 } });
        wf.component('pif-title', {
            props: { title: {} },
            computed: { loud() { return String(this.props.title).toUpperCase(); } },
        });
        container.innerHTML = `
            <div data-component="pif-wrap">
                <div data-component="pif-title" data-props="{ title: $pif-page-store.title }">
                    <h1 id="pif-h1" data-bind="props.title"></h1>
                    <p id="pif-loud" data-bind="loud"></p>
                </div>
            </div>`;
        wf.scan();
        await settle();
        expect(container.querySelector('#pif-h1').textContent).toBe('First');
        wf.getStore('pif-page-store').title = 'Second';
        await settle();
        expect(instanceOf('[data-component="pif-title"]').props.title).toBe('Second');
        expect(container.querySelector('#pif-h1').textContent).toBe('Second');
        expect(container.querySelector('#pif-loud').textContent).toBe('SECOND');
    });
});
