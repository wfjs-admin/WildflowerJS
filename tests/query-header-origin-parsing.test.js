/**
 * Origin-scoped header defaults follow the origin the browser actually
 * requests.
 *
 * `config({ headers })` keys credentials by origin, so a header declared for
 * one origin reaches that origin only. The origin used to be read from the
 * URL with a pattern that disagreed with the browser's URL parser: the
 * parser treats a backslash as a slash in http(s) URLs, strips leading
 * spaces and every tab and newline, accepts `https:/host` when the page's
 * scheme differs, and ends the host at a backslash. Each of those URLs was
 * read as same-origin (or as the declared API origin) while the request went
 * to another host, carrying the credential. The origin now comes from the
 * URL parser itself, so the header decision and the request agree.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const suite = hasFeature('query') ? describe : describe.skip

let seq = 0
const uname = (p) => `${p}-ho-${++seq}`
const settle = (ms = 100) => new Promise(r => setTimeout(r, ms))

suite('origin-scoped header defaults follow the requested origin', () => {
    let container
    let wildflower
    let realFetch
    let calls

    beforeAll(async () => {
        await loadFramework()
    })

    beforeEach(() => {
        wildflower = window.wildflower
        resetFramework()
        container = document.createElement('div')
        document.body.appendChild(container)
        realFetch = window.fetch
        calls = []
        window.fetch = async (url, init = {}) => {
            calls.push({ origin: new URL(url, location.href).origin, headers: { ...(init.headers || {}) } })
            return new Response('[{"id":1,"title":"a"}]', { status: 200 })
        }
        wildflower.config({ headers: {
            self: { Authorization: 'Bearer SELF' },
            'https://api.example.com': { 'X-Api-Key': 'APIKEY' }
        } })
    })

    afterEach(() => {
        window.fetch = realFetch
        wildflower.config({ headers: undefined })
        if (container && container.parentNode) container.parentNode.removeChild(container)
        container = null
    })

    async function firstRequest(from) {
        const q = uname('q'); const c = uname('c')
        wildflower.query(q, { from })
        container.innerHTML = `
            <div data-component="${c}">
                <ul data-query="${q}"><template><li><span data-bind="title"></span></li></template></ul>
            </div>
        `
        wildflower.component(c, { state: {} })
        wildflower.scan(container)
        await settle()
        return calls[0]
    }

    const otherScheme = () => (location.protocol === 'https:' ? 'http:' : 'https:')

    for (const [label, from] of [
        ['a backslash after the leading slash', '/\\evil.test/api'],
        ['two leading backslashes', '\\\\evil.test/api'],
        ['a leading space before //', ' //evil.test/api'],
        ['a tab between the slashes', '/\t/evil.test/api'],
        ['a scheme with one slash', null],
        ['a backslash before userinfo', 'https://evil.test\\@api.example.com/api'],
    ]) {
        it(`no declared header reaches another host: ${label}`, async () => {
            const r = await firstRequest(from || otherScheme() + '/evil.test/api')
            expect(r.origin).not.toBe(location.origin)
            expect(r.origin).not.toBe('https://api.example.com')
            expect(r.headers).toEqual({})
        })
    }

    it('a relative URL still receives the self default', async () => {
        const r = await firstRequest('/api/x')
        expect(r.headers).toEqual({ Authorization: 'Bearer SELF' })
    })

    it('a declared origin still receives its default, whatever the case', async () => {
        const r = await firstRequest('HTTPS://API.Example.com/x')
        expect(r.headers).toEqual({ 'X-Api-Key': 'APIKEY' })
    })

    it('userinfo is not part of the origin', async () => {
        const r = await firstRequest('https://user:pw@api.example.com/x')
        expect(r.headers).toEqual({ 'X-Api-Key': 'APIKEY' })
    })
})
