/**
 * A component's props in binding expressions: data-bind-attr="{ href:
 * props.next }", data-bind-style, data-show="props.width > 15" and
 * data-bind="props.next + '!'" set their value on the first paint and follow
 * the parent when it changes the prop, as data-bind="props.next" does.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

describe('props in binding expressions', () => {
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

    function mount() {
        wf.component('pab-parent', { state: { next: '/a', tone: 'calm', width: 10, locked: true } });
        wf.component('pab-child', { props: { next: {}, tone: {}, width: {}, locked: {} } });
        container.innerHTML = `
            <div data-component="pab-parent">
                <div data-component="pab-child" data-props="{ next: next, tone: tone, width: width, locked: locked }">
                    <a id="pab-link" data-bind-attr="{ href: props.next, title: props.next }">next</a>
                    <button id="pab-btn" data-bind-attr="{ disabled: props.locked }">go</button>
                    <p id="pab-class" data-bind-class="props.tone"></p>
                    <p id="pab-style" data-bind-style="{ width: props.width + 'px' }"></p>
                    <p id="pab-show" data-show="props.width > 15">wide</p>
                    <p id="pab-text" data-bind="props.next + '!'"></p>
                </div>
            </div>`;
        wf.scan();
    }

    it('sets them on the first paint', async () => {
        mount();
        await settle();
        expect(container.querySelector('#pab-link').getAttribute('href')).toBe('/a');
        expect(container.querySelector('#pab-link').getAttribute('title')).toBe('/a');
        expect(container.querySelector('#pab-btn').disabled).toBe(true);
        expect(container.querySelector('#pab-class').classList.contains('calm')).toBe(true);
        expect(container.querySelector('#pab-style').style.width).toBe('10px');
        expect(container.querySelector('#pab-show').style.display).toBe('none');
        expect(container.querySelector('#pab-text').textContent).toBe('/a!');
    });

    it('follows the parent when it changes the props', async () => {
        mount();
        await settle();
        const parent = instanceOf('[data-component="pab-parent"]');
        parent.state.next = '/b';
        parent.state.tone = 'loud';
        parent.state.width = 20;
        parent.state.locked = false;
        await settle();
        expect(container.querySelector('#pab-link').getAttribute('href')).toBe('/b');
        expect(container.querySelector('#pab-link').getAttribute('title')).toBe('/b');
        expect(container.querySelector('#pab-btn').disabled).toBe(false);
        expect(container.querySelector('#pab-class').classList.contains('loud')).toBe(true);
        expect(container.querySelector('#pab-class').classList.contains('calm')).toBe(false);
        expect(container.querySelector('#pab-style').style.width).toBe('20px');
        expect(container.querySelector('#pab-show').style.display).not.toBe('none');
        expect(container.querySelector('#pab-text').textContent).toBe('/b!');
    });
});
