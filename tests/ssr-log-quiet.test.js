/**
 * The SSR manager's progress lines ("Protecting SSR element", "Activating
 * SSR component ...") are debug output: a development build prints none of
 * them unless debug is asked for (data-debug on the script tag, see
 * ssr-log-debug-opt-in.test.js, or the SSR manager's logLevel 'debug').
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, waitForUpdate } from './helpers/load-framework.js'

const suite = hasFeature('ssr') ? describe : describe.skip
let seq = 0

suite('SSR manager logging, no debug asked for', () => {
    let wildflower, container, logs, origLog
    beforeAll(async () => { await loadFramework(); wildflower = window.wildflower })
    beforeEach(() => {
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        logs = []
        origLog = console.log
        console.log = (...args) => { logs.push(args.map(String).join(' ')); origLog.apply(console, args) }
    })
    afterEach(() => { console.log = origLog; container.remove() })

    it('a dev build prints no SSR manager lines while server markup is adopted', async () => {
        const c = `ssrq-${++seq}`
        wildflower.component(c, { state: { title: 'Server', rows: [] } })
        container.innerHTML = `<div data-component="${c}" data-ssr="true"><h1 data-bind="title">Server</h1></div>`
        wildflower.scan(container)
        wildflower.ssrManager && wildflower.ssrManager.activateAllComponents()
        await waitForUpdate()
        await new Promise(r => setTimeout(r, 60))
        expect(container.querySelector('h1').textContent).toBe('Server')
        expect(logs.filter(line => line.includes('[SSRManager]'))).toEqual([])
    })
})
