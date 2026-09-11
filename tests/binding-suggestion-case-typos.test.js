/**
 * Binding suggestion quality — case-only typos and ranking.
 *
 * WF-509 already warns when a binding references a property that doesn't exist,
 * and offers "Did you mean" suggestions drawn from the component's own state and
 * computed names. Two gaps in the matcher:
 *
 *   1. Case-only typos produce NO suggestion. _findSimilarPropertyNames lowercases
 *      both sides and then requires distance > 0, so "selectedid" vs "selectedId"
 *      scores 0 and is filtered out — the single most common typo class gets the
 *      warning with no fix offered.
 *   2. Suggestions are not ranked. Candidates are collected in Object.keys order
 *      and the first three within the threshold win, so a distance-1 match can be
 *      dropped in favour of a distance-3 one that happened to be declared earlier.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework, hasConsoleWarnings, hasFeature } from './helpers/load-framework.js';

const suiteRunner = hasFeature('validation') ? describe : describe.skip;

async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

function createWarnCapture() {
    const captured = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        captured.push(args.join(' '));
        originalWarn.apply(console, args);
    };
    return {
        captured,
        restore: () => { console.warn = originalWarn; }
    };
}

// Find the WF warning that mentions `badName` and return its "Did you mean" list.
function suggestionFor(captured, badName) {
    const warning = captured.find(msg => msg.includes('[WF') && msg.includes(badName));
    if (!warning) return null;
    const match = warning.match(/Did you mean:\s*([^?]+)\?/);
    return match ? match[1].split(',').map(s => s.trim()) : [];
}

suiteRunner('Binding suggestions: case-only typos and ranking', () => {
    let wildflower;
    let testContainer;

    beforeAll(async () => {
        await loadFramework();
    });

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

    it('suggests the correct name for an all-lowercase typo', async () => {
        const warnCapture = createWarnCapture();

        wildflower.component('suggest-case-1', {
            state: { rows: [], selectedId: null }
        });

        testContainer.innerHTML = `
            <div data-component="suggest-case-1">
                <span data-bind="selectedid"></span>
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            const suggestions = suggestionFor(warnCapture.captured, 'selectedid');
            expect(suggestions).not.toBeNull();
            expect(suggestions).toContain('selectedId');
        }
    });

    it('suggests the correct name for a mixed-case typo', async () => {
        const warnCapture = createWarnCapture();

        wildflower.component('suggest-case-2', {
            state: { rows: [], selectedId: null }
        });

        testContainer.innerHTML = `
            <div data-component="suggest-case-2">
                <span data-bind="SelectedID"></span>
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            const suggestions = suggestionFor(warnCapture.captured, 'SelectedID');
            expect(suggestions).not.toBeNull();
            expect(suggestions).toContain('selectedId');
        }
    });

    it('still suggests for a separator typo (regression guard)', async () => {
        const warnCapture = createWarnCapture();

        wildflower.component('suggest-case-3', {
            state: { rows: [], selectedId: null }
        });

        testContainer.innerHTML = `
            <div data-component="suggest-case-3">
                <span data-bind="selected_id"></span>
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            const suggestions = suggestionFor(warnCapture.captured, 'selected_id');
            expect(suggestions).not.toBeNull();
            expect(suggestions).toContain('selectedId');
        }
    });

    it('ranks the nearest candidate first', async () => {
        const warnCapture = createWarnCapture();

        // Declaration order puts the WORSE match first, so an unranked matcher
        // reports selectedIdx ahead of the exact case-insensitive hit.
        wildflower.component('suggest-rank-1', {
            state: { selectedIdx: 0, selectedId: null }
        });

        testContainer.innerHTML = `
            <div data-component="suggest-rank-1">
                <span data-bind="selectedid"></span>
            </div>
        `;

        await wildflower.scan();
        await waitForUpdate();
        warnCapture.restore();

        if (hasConsoleWarnings()) {
            const suggestions = suggestionFor(warnCapture.captured, 'selectedid');
            expect(suggestions).not.toBeNull();
            expect(suggestions[0]).toBe('selectedId');
        }
    });
});
