/**
 * Probe: STATIC-mode promotion for computeds with variable array-index
 * access whose body contains neither conditionals nor function calls.
 *
 * The CONDITIONAL_PATTERN regex in ComputedPropertyManager.js detects:
 *   - if/else/switch/case
 *   - ternary `?`
 *   - short-circuit `&& || ??`
 *   - any function call (identifier followed by `(`)
 *
 * If none match, the computed is treated as deterministic and may be
 * promoted to STATIC mode, which BYPASSES proxy access entirely on
 * subsequent evaluations. Future reads aren't tracked.
 *
 * But variable-index array access — `state.items[state.idx]` — IS
 * conditional in effect: different `idx` values read different paths.
 * The regex doesn't catch bracket notation. If the same dep COUNT happens
 * to match across two evaluations (e.g., 2 deps both times: idx + items.N),
 * the framework promotes to STATIC and freezes the dep set against the
 * current `idx`. Subsequent changes to `items[newIdx]` after another
 * `idx` change wouldn't dirty the computed.
 *
 * This test fires-or-doesn't-fire to characterise current behaviour.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function nextTick(ms = 30) {
    await new Promise(r => setTimeout(r, ms))
}

describe('STATIC-mode promotion + variable array-index access', () => {
    let wildflower
    beforeAll(async () => { await loadFramework() })
    beforeEach(() => { wildflower = window.wildflower; resetFramework() })

    it('selected-item pattern: idx=0 → idx=1 → mutate items[1].label updates the bound text', async () => {
        const container = document.createElement('div')
        container.style.position = 'absolute'
        container.style.left = '-9999px'
        document.body.appendChild(container)

        try {
            wildflower.component('static-idx', {
                state: {
                    items: [
                        { id: 1, label: 'a' },
                        { id: 2, label: 'b' }
                    ],
                    idx: 0
                },
                computed: {
                    // Body has no conditionals and no function calls — eligible
                    // for STATIC mode after the second eval if dep counts match.
                    selectedLabel() { return this.state.items[this.state.idx].label }
                },
                pickFirst() { this.state.idx = 0 },
                pickSecond() { this.state.idx = 1 },
                renameSecond() { this.state.items[1].label = 'B!' }
            })

            container.innerHTML = `
                <div data-component="static-idx">
                    <span class="t" data-bind="selectedLabel"></span>
                </div>
            `
            wildflower.scan()
            await nextTick(50)

            const t = container.querySelector('.t')
            expect(t.textContent).toBe('a')

            const inst = wildflower.getComponentsByType('static-idx')[0]

            // Switch to second item — dep count stays at 2 ({idx, items.X}),
            // counts match across runs so promotion is eligible.
            inst.context.pickSecond()
            await nextTick(50)
            expect(t.textContent).toBe('b')

            // Now mutate items[1].label. If STATIC-mode locked the dep set
            // against items.1 from the previous eval, the path-level
            // notification for items.1.label still reaches the computed
            // (because items.1 is in deps and items.1.label is a sub-path).
            // But STATIC mode skips re-tracking on the resulting eval, so
            // the effect of bracket-index access only matters across idx
            // changes, not across nested-prop mutations on the current item.
            inst.context.renameSecond()
            await nextTick(50)

            // EXPECTED if STATIC-mode handles this correctly: 'B!'
            // EXPECTED if STATIC-mode is broken for this pattern: still 'b'
            expect(t.textContent).toBe('B!')
        } finally {
            container.remove()
        }
    })

    it('idx flips back-and-forth: items[0] mutation after idx=1 then idx=0 sequence still updates', async () => {
        // Sharper test: drive idx through 0 → 1 → 0, then mutate items[0].
        // If STATIC mode locked the dep set against items.1 (the value from
        // promotion-eligible second run) and subsequent reads of items[0]
        // weren't tracked, items[0].label mutation wouldn't dirty the
        // computed.
        const container = document.createElement('div')
        container.style.position = 'absolute'
        container.style.left = '-9999px'
        document.body.appendChild(container)

        try {
            wildflower.component('static-idx-flip', {
                state: {
                    items: [
                        { id: 1, label: 'a' },
                        { id: 2, label: 'b' }
                    ],
                    idx: 0
                },
                computed: {
                    selectedLabel() { return this.state.items[this.state.idx].label }
                },
                pickFirst() { this.state.idx = 0 },
                pickSecond() { this.state.idx = 1 },
                renameFirst() { this.state.items[0].label = 'A!' }
            })

            container.innerHTML = `
                <div data-component="static-idx-flip">
                    <span class="t" data-bind="selectedLabel"></span>
                </div>
            `
            wildflower.scan()
            await nextTick(50)
            const t = container.querySelector('.t')
            const inst = wildflower.getComponentsByType('static-idx-flip')[0]

            expect(t.textContent).toBe('a')

            inst.context.pickSecond()  // idx=1, may promote to STATIC with items.1 in deps
            await nextTick(50)
            expect(t.textContent).toBe('b')

            inst.context.pickFirst()   // idx=0, items[0] reads happen; if STATIC, untracked
            await nextTick(50)
            expect(t.textContent).toBe('a')

            inst.context.renameFirst() // mutate items[0].label
            await nextTick(50)

            // If items.0 isn't in node.deps (dep set locked at idx=1), the
            // notification doesn't dirty the computed. Bound text stays 'a'.
            expect(t.textContent).toBe('A!')
        } finally {
            container.remove()
        }
    })
})
