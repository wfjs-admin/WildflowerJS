/**
 * WF-509 must not fire for slot-template bindings (data-use-template + data-with).
 *
 * A configurable template is expanded against the object named by `data-with`,
 * so its bindings resolve in THAT scope, not the host component's state. Every
 * runtime binding processor already skips these elements via
 * `el.closest('[data-use-template-rendered]')` (RenderingCore.js:80, :634,
 * :1007, :2054). The dev-only validator `_validateComponentBindings` was the one
 * place missing that guard, so it validated the template's bindings against the
 * component's own state keys and reported perfectly valid bindings as undefined.
 *
 * Found on /docs/configurable-templates, where the working `server-monitor` demo
 * drew:
 *   [WF WF-509] data-bind-class expression "healthy ? 'alert-success' :
 *   'alert-danger'" references undefined state property "healthy" in component
 *   "server-monitor" Available properties: server
 *
 * The demo was correct; the warning was not. A false positive here is costly
 * because it trains people to ignore a diagnostic that is usually right.
 *
 * The suite deliberately pairs each "must not warn" assertion with a
 * known-positive case in the SAME setup, so a silently broken warning channel
 * (validation disabled, warnings stripped, component never scanned) cannot make
 * these tests pass green.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, hasConsoleWarnings, hasFeature } from './helpers/load-framework.js';

const suiteRunner = (hasFeature('validation') && hasFeature('templates')) ? describe : describe.skip;

async function waitForUpdate(ms = 60) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

function createWarnCapture() {
    const captured = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        captured.push(args.join(' '));
        originalWarn.apply(console, args);
    };
    return { captured, restore: () => { console.warn = originalWarn; } };
}

const wf509For = (captured, token) => captured.find(msg =>
    msg.includes('[WF') && msg.includes('WF-509') && msg.includes(token)
);

suiteRunner('WF-509 vs slot-template scope', () => {
    let wildflower;
    let testContainer;

    beforeAll(async () => { await loadFramework(); });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();

        wildflower.options.debug = true;
        wildflower.debug = true;

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        testContainer.style.position = 'absolute';
        testContainer.style.left = '-9999px';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
    });

    // Mirrors the shape of the /docs/configurable-templates demo: a template
    // owned by an outer component, used by an inner one against a state object.
    function mountSlotDemo(componentName) {
        wildflower.component('slot-host-outer', { state: {} });
        wildflower.component(componentName, {
            state: {
                server: { name: 'API Gateway', healthy: true, latency: 42 }
            },
            toggleStatus() { this.server.healthy = !this.server.healthy; }
        });

        testContainer.innerHTML = `
            <div data-component="slot-host-outer">
                <template data-item-template="statusCard">
                    <div class="alert card" data-bind-class="healthy ? 'alert-success' : 'alert-danger'">
                        <strong class="nm" data-bind="name"></strong>
                        <span class="st" data-bind="healthy ? 'Online' : 'Offline'"></span>
                        <small class="lat" data-bind="latency"></small>
                    </div>
                </template>
                <div data-component="${componentName}">
                    <div data-use-template="statusCard" data-with="server"></div>
                    <button class="tog" data-action="toggleStatus"></button>
                </div>
            </div>
        `;
    }

    it('does not warn for bindings that resolve through data-with', async () => {
        const warnCapture = createWarnCapture();
        mountSlotDemo('slot-scope-monitor');

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            expect(wf509For(warnCapture.captured, 'healthy')).toBeUndefined();
            expect(wf509For(warnCapture.captured, 'latency')).toBeUndefined();
        }
    });

    it('still warns for a genuinely undefined property on the same component (channel calibration)', async () => {
        const warnCapture = createWarnCapture();

        wildflower.component('slot-scope-control', {
            state: { server: { name: 'API Gateway', healthy: true, latency: 42 } }
        });

        testContainer.innerHTML = `
            <div data-component="slot-scope-control">
                <span data-bind="definitelyNotAProperty"></span>
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        // If this fails, the warning channel itself is broken and the
        // "does not warn" assertions above prove nothing.
        if (hasConsoleWarnings()) {
            expect(wf509For(warnCapture.captured, 'definitelyNotAProperty')).toBeDefined();
        }
    });

    it('renders the slot template correctly (the bindings really do resolve)', async () => {
        mountSlotDemo('slot-scope-render');

        await wildflower.scan();
        await waitForUpdate();

        const alert = testContainer.querySelector('.alert');
        expect(alert).toBeTruthy();
        expect(testContainer.querySelector('.nm').textContent).toBe('API Gateway');
        expect(testContainer.querySelector('.st').textContent).toBe('Online');
        expect(testContainer.querySelector('.lat').textContent).toBe('42');
        expect(alert.className).toContain('alert-success');
    });

    it('keeps slot-template class bindings reactive after a state change', async () => {
        mountSlotDemo('slot-scope-reactive');

        await wildflower.scan();
        await waitForUpdate();

        const before = testContainer.querySelector('.alert').className;
        expect(before).toContain('alert-success');

        testContainer.querySelector('.tog').click();
        await waitForUpdate(120);

        const after = testContainer.querySelector('.alert').className;
        expect(after).toContain('alert-danger');
        expect(testContainer.querySelector('.st').textContent).toBe('Offline');
    });
});
