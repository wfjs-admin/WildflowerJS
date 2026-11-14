/**
 * data-debug on the script tag turns the SSR manager's progress lines on in
 * a development build (production strips console.log). Loads the framework
 * by hand, since the attribute is read as the script runs; each test file
 * has its own realm, so this load is this file's only one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getFrameworkScripts, hasFeature, isMinifiedBuild, waitForUpdate } from './helpers/load-framework.js'

const suite = hasFeature('ssr') && !isMinifiedBuild() ? describe : describe.skip

suite('SSR manager logging with data-debug', () => {
    const logs = []
    let origLog
    beforeAll(async () => {
        origLog = console.log
        console.log = (...args) => { logs.push(args.map(String).join(' ')); origLog.apply(console, args) }
        for (const src of getFrameworkScripts()) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script')
                s.src = src
                s.setAttribute('data-debug', 'true')
                s.onload = resolve
                s.onerror = reject
                document.head.appendChild(s)
            })
        }
        await new Promise(r => setTimeout(r, 100))
    })
    afterAll(() => { console.log = origLog })

    it('prints the SSR manager lines while server markup is adopted', async () => {
        const wildflower = window.wildflower
        wildflower.component('ssrd-a', { state: { title: 'Server' } })
        const container = document.createElement('div')
        document.body.appendChild(container)
        container.innerHTML = '<div data-component="ssrd-a" data-ssr="true"><h1 data-bind="title">Server</h1></div>'
        wildflower.scan(container)
        wildflower.ssrManager.activateAllComponents()
        await waitForUpdate()
        await new Promise(r => setTimeout(r, 60))
        expect(logs.filter(line => line.includes('[SSRManager]')).length).toBeGreaterThan(0)
        container.remove()
    })
})
