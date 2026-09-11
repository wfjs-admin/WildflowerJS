/**
 * WF-509 must not fire for a store-alias `data-model="storeName.field"` path.
 *
 * `data-model` supports a documented store-routing convention: when the
 * first dotted segment names a registered store, FormHandling's write path
 * routes the write to that store's state instead of the component's own
 * (RenderingCore's _executeComponentBindingsForEffect mirrors this on the
 * read side for state→DOM sync — see the pendingWrites/store-model-repaint
 * work). The dev-only validator `_validateComponentBindings` never learned
 * this convention: it treated "editor.title" as a plain nested path on
 * component state, found no `editor` key, and reported a perfectly valid
 * binding as undefined.
 *
 * Found live on the Conduit build's editor/settings forms (WF-509 firing on
 * every `data-model="editor.title"`-style field) while diagnosing an
 * unrelated bug on that app.
 *
 * The suite pairs each "must not warn" assertion with a known-positive case
 * in the same setup, per the slot-template validation suite's pattern, so a
 * silently broken warning channel cannot make these tests pass green.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, hasConsoleWarnings, hasFeature } from './helpers/load-framework.js';

const suiteRunner = hasFeature('validation') ? describe : describe.skip;

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

suiteRunner('WF-509 vs store-alias data-model paths', () => {
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

    it('does not warn for a data-model path whose root names a registered store', async () => {
        const warnCapture = createWarnCapture();

        wildflower.store('editorDraft', { state: { title: '', body: '' } });
        wildflower.component('editor-form-host', { state: {} });

        testContainer.innerHTML = `
            <div data-component="editor-form-host">
                <input data-model="editorDraft.title">
                <textarea data-model="editorDraft.body"></textarea>
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            expect(wf509For(warnCapture.captured, 'editorDraft')).toBeUndefined();
        }
    });

    it('still warns for a genuinely undefined data-model root (channel calibration)', async () => {
        const warnCapture = createWarnCapture();

        wildflower.component('model-validation-control', { state: { draft: {} } });

        testContainer.innerHTML = `
            <div data-component="model-validation-control">
                <input data-model="definitelyNotAStoreOrState.field">
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            expect(wf509For(warnCapture.captured, 'definitelyNotAStoreOrState')).toBeDefined();
        }
    });

    it('a component-state data-model path (no store of that name) still warns correctly', async () => {
        const warnCapture = createWarnCapture();

        // No store named "profile" registered — this must still be flagged,
        // proving the store-alias skip is scoped to REGISTERED stores only.
        wildflower.component('model-validation-noshadow', { state: { name: '' } });

        testContainer.innerHTML = `
            <div data-component="model-validation-noshadow">
                <input data-model="profile.email">
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            expect(wf509For(warnCapture.captured, 'profile')).toBeDefined();
        }
    });

    it('binds and writes correctly through the store-alias path (the validated binding really works)', async () => {
        wildflower.store('editorDraft2', { state: { title: '' } });
        wildflower.component('editor-form-render', { state: {} });

        testContainer.innerHTML = `
            <div data-component="editor-form-render">
                <input class="ti" data-model="editorDraft2.title">
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();

        const input = testContainer.querySelector('.ti');
        input.focus();
        input.value = 'Hello';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await waitForUpdate();

        expect(wildflower.getStore('editorDraft2').title).toBe('Hello');
    });
});
