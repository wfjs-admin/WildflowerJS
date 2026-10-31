/**
 * A computed that reads only `this.props` has no sources in the graph, since
 * props have no edge. A prop change invalidates it by hand, and that change
 * must reach everything that follows the computed: a `watch:` and a
 * `data-list` over it, not only a `data-bind`. 1.5.4 did; the WF-238 loop
 * guard (pull-only re-runs of source-less computeds wake no readers) stopped
 * both (1.5.5 review G-01).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('A computed that reads only props follows a prop change', () => {
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

    const mount = (heard) => {
        wf.component('poc-child', {
            props: { incoming: {} },
            computed: {
                pure() { return 'p:' + this.props.incoming; },
                rows() { return String(this.props.incoming).split('').map((c, i) => ({ id: i, c })); }
            },
            watch: { pure(v) { heard.push(v); } }
        });
        wf.component('poc-parent', { state: { val: 'a' } });
        container.innerHTML = `
            <div id="p" data-component="poc-parent">
                <div data-component="poc-child" data-prop-incoming="val">
                    <span id="out" data-bind="pure"></span>
                    <ul id="list" data-list="rows" data-key="id"><template><li data-bind="c"></li></template></ul>
                </div>
            </div>
        `;
        wf.scan();
    };

    const parent = () => wf.getComponentsByType('poc-parent')[0].context;
    const listText = () => [...container.querySelectorAll('#list li')].map((li) => li.textContent).join('');

    it('a watch on it fires', async () => {
        const heard = [];
        mount(heard);
        await waitForInit();
        parent().val = 'bcd';
        await waitForInit(120);
        expect(container.querySelector('#out').textContent).toBe('p:bcd');
        expect(heard).toEqual(['p:bcd']);
    });

    it('a list over it renders the new rows', async () => {
        mount([]);
        await waitForInit();
        expect(listText()).toBe('a');
        parent().val = 'bcd';
        await waitForInit(120);
        expect(listText()).toBe('bcd');
    });
});
