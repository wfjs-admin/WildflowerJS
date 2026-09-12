/**
 * ES-module bundles (added 1.5.1): every tier's .dev.js / .min.js has an
 * .esm.dev.js / .esm.min.js twin built with rollup format 'es'. The default
 * export is the framework instance, the named exports match the entry file,
 * and importing the module registers window.wildflower exactly like the
 * script-tag build does.
 *
 * The suite already has the IIFE bundle for the current lane loaded, so this
 * test imports the ESM twin of the SAME tier and checks its shape rather than
 * re-running the framework against the DOM (two instances on one document
 * would both scan it).
 */

import { describe, it, expect } from 'vitest'
import { getDistMode, getFrameworkScripts } from './helpers/load-framework.js'

function esmTwinOfCurrentLane() {
    const [script] = getFrameworkScripts(getDistMode())
    if (!script || !/\.(dev|min)\.js$/.test(script)) return null   // 'source' mode has no bundle
    return script.replace(/\.(dev|min)\.js$/, '.esm.$1.js')
}

describe('ES-module bundle', () => {
    it('exports the instance as default and the framework surface as named exports', async () => {
        const url = esmTwinOfCurrentLane()
        if (!url) return
        const mod = await import(/* @vite-ignore */ url)
        expect(typeof mod.default).toBe('object')
        expect(typeof mod.default.component).toBe('function')
        expect(typeof mod.default.store).toBe('function')
        expect(typeof mod.default.version).toBe('string')
        expect(mod.wildflower).toBe(mod.default)
        expect(typeof mod.WildflowerJS).toBe('function')
    })

    it('registers the same global the script-tag build does', async () => {
        const url = esmTwinOfCurrentLane()
        if (!url) return
        const mod = await import(/* @vite-ignore */ url)
        // createInstance assigns window.wildflower; the ESM twin is the last one loaded.
        expect(window.wildflower).toBe(mod.default)
    })
})
