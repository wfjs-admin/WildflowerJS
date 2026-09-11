/**
 * An error thrown by application code reaches the console in EVERY build.
 *
 * The framework catches errors from user code so one bad handler cannot take
 * the page down, then routes them to _handleError. That is right. What was
 * wrong is that the default `errorHandling: 'log'` mode wrapped its
 * console.error in a __DEV__ guard, so minification removed it: in a
 * production build a typo in an action handler produced a dead control and
 * an empty console, with no way to tell a broken handler from one that ran
 * and changed nothing.
 *
 * The framework's OWN diagnostics (the WF-nnn codes) stay development-only.
 * This is about the author's exception, which belongs to the author.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function settle(ms = 60) {
    await new Promise(r => setTimeout(r, ms))
}

let seq = 0
const uname = (p) => `${p}-evp-${++seq}`

describe('Application errors are visible in every build', () => {
    let container
    let wildflower
    let errors
    let realError

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        errors = []
        realError = console.error
        console.error = (...a) => { errors.push(a.map(String).join(' ')) }
    })

    afterEach(() => {
        console.error = realError
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    const reported = () => errors.filter(e => e.includes('WildflowerJS'))

    it('an action handler that throws is reported, naming the component and the method', async () => {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"><button data-action="increment">go</button></div>`
        wildflower.component(c, {
            state: { count: 0 },
            increment() { this.count += missingIdentifier; }   // eslint-disable-line no-undef
        })
        wildflower.scan(container)
        await settle()

        container.querySelector('button').click()
        await settle()

        const hit = reported()
        expect(hit.length, 'the thrown error was reported').toBeGreaterThan(0)
        const text = hit.join(' | ')
        expect(text).toContain('increment')
        expect(text).toContain(c)
        expect(text).toMatch(/missingIdentifier|ReferenceError/)
    })

    it('the page keeps working after the error', async () => {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}">
            <span class="v" data-bind="count"></span>
            <button class="bad" data-action="bad">bad</button>
            <button class="good" data-action="good">good</button>
        </div>`
        wildflower.component(c, {
            state: { count: 0 },
            bad() { throw new Error('deliberate'); },
            good() { this.count++; }
        })
        wildflower.scan(container)
        await settle()

        container.querySelector('.bad').click()
        await settle()
        container.querySelector('.good').click()
        await settle()

        expect(container.querySelector('.v').textContent).toBe('1')
        expect(reported().length).toBeGreaterThan(0)
    })

    it('an error thrown in init() is reported', async () => {
        const c = uname('c')
        container.innerHTML = `<div data-component="${c}"></div>`
        wildflower.component(c, {
            state: {},
            init() { throw new Error('init exploded'); }
        })
        wildflower.scan(container)
        await settle()

        expect(reported().join(' | ')).toMatch(/init exploded/)
    })

    it('errorHandling: "silent" still says nothing', async () => {
        const c = uname('c')
        const previous = wildflower.options.errorHandling
        wildflower.config({ errorHandling: 'silent' })
        try {
            container.innerHTML = `<div data-component="${c}"><button data-action="boom">x</button></div>`
            wildflower.component(c, {
                state: {},
                boom() { throw new Error('quiet please'); }
            })
            wildflower.scan(container)
            await settle()
            container.querySelector('button').click()
            await settle()
            expect(reported()).toEqual([])
        } finally {
            wildflower.config({ errorHandling: previous })
        }
    })

    it('a registered global error handler still takes precedence over the log', async () => {
        const c = uname('c')
        const seen = []
        const handler = (err) => seen.push(err && err.message)
        wildflower.onError(handler)
        try {
            container.innerHTML = `<div data-component="${c}"><button data-action="boom">x</button></div>`
            wildflower.component(c, {
                state: {},
                boom() { throw new Error('handled elsewhere'); }
            })
            wildflower.scan(container)
            await settle()
            container.querySelector('button').click()
            await settle()
            expect(seen).toContain('handled elsewhere')
            expect(reported()).toEqual([])
        } finally {
            wildflower.offError(handler)
        }
    })
})
