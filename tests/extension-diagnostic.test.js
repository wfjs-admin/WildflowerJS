/**
 * wildflower.diagnostic(): a coded diagnostic from an extension, printed and
 * recorded the way the framework's own are. Development cores only: it prints
 * `[CODE] message: context` with the Suggestion and Docs lines, records a
 * frozen entry in wildflower.diagnostics, dispatches wildflower:diagnostic,
 * and returns the entry. The docs link is always derived from the code.
 * Production cores do not have the method, so an extension feature-detects
 * it and prints its own line.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { loadFramework, isMinifiedBuild } from './helpers/load-framework.js'

beforeAll(async () => { await loadFramework() })

function capture(fn) {
    const warns = [], errors = []
    const w = console.warn, e = console.error
    console.warn = (...a) => warns.push(a.map(String).join(' '))
    console.error = (...a) => errors.push(a.map(String).join(' '))
    let out
    try { out = fn() } finally { console.warn = w; console.error = e }
    return { warns, errors, out }
}

const DOCS = 'https://www.wildflowerjs.com/docs/error-codes?code='

describe.skipIf(isMinifiedBuild())('wildflower.diagnostic (development cores)', () => {
    it('prints a warning line, the Suggestion line and the Docs line', () => {
        const { warns, errors } = capture(() => wildflower.diagnostic({
            code: 'KN-901', message: 'A scene has no duration', context: 'intro', suggestion: 'Give it data-duration'
        }))
        expect(errors).toEqual([])
        expect(warns[0]).toBe('[KN-901] A scene has no duration: intro')
        expect(warns).toContain('  ↳ Suggestion: Give it data-duration')
        expect(warns).toContain('  ↳ Docs: ' + DOCS + 'KN-901')
    })

    it('prints an error through console.error when severity is error', () => {
        const { warns, errors } = capture(() => wildflower.diagnostic({
            code: 'KN-902', severity: 'error', message: 'The render failed'
        }))
        expect(errors).toEqual(['[KN-902] The render failed'])
        expect(warns).toEqual(['  ↳ Docs: ' + DOCS + 'KN-902'])
    })

    it('prints the code alone when there is no message', () => {
        const { warns } = capture(() => wildflower.diagnostic({ code: 'TH-903' }))
        expect(warns[0]).toBe('[TH-903]')
    })

    it('derives the docs link from the code, and ignores a docs key', () => {
        const { out } = capture(() => wildflower.diagnostic({ code: '3D-904', message: 'm', docs: 'https://example.com' }))
        expect(out.docs).toBe(DOCS + '3D-904')
    })

    it('returns the frozen entry and records it in wildflower.diagnostics', () => {
        wildflower.diagnostics.length = 0
        const { out } = capture(() => wildflower.diagnostic({
            code: 'KN-905', message: 'msg', context: 'ctx', suggestion: 'sug', cause: new Error('boom')
        }))
        expect(Object.isFrozen(out)).toBe(true)
        expect(wildflower.diagnostics.length).toBe(1)
        expect(wildflower.diagnostics[0]).toBe(out)
        expect(out.code).toBe('KN-905')
        expect(out.severity).toBe('warning')
        expect(out.message).toBe('msg')
        expect(out.context).toBe('ctx')
        expect(out.suggestion).toBe('sug')
        expect(out.cause).toBe('boom')
        expect(typeof out.time).toBe('number')
    })

    it('records an entry with no message as message ""', () => {
        const { out } = capture(() => wildflower.diagnostic({ code: 'KN-906', severity: 'error' }))
        expect(out.message).toBe('')
        expect(out.severity).toBe('error')
        expect(out.context).toBe(null)
        expect(out.suggestion).toBe(null)
    })

    it('dispatches the entry as a wildflower:diagnostic event', () => {
        const got = []
        const on = (ev) => got.push(ev.detail)
        document.addEventListener('wildflower:diagnostic', on)
        let out
        try { out = capture(() => wildflower.diagnostic({ code: 'KN-907', message: 'm' })).out } finally {
            document.removeEventListener('wildflower:diagnostic', on)
        }
        expect(got.length).toBe(1)
        expect(got[0]).toBe(out)
    })
})

describe.skipIf(!isMinifiedBuild())('wildflower.diagnostic (production cores)', () => {
    it('is not there', () => {
        expect(wildflower.diagnostic).toBeUndefined()
        expect(wildflower.diagnostics).toBeUndefined()
    })
})
