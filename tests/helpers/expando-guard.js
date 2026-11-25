/**
 * Element property guard, loaded by every test file as a setup file.
 *
 * The framework keeps some bookkeeping as own properties on DOM nodes and on
 * events. A production build renames internal properties, and a name it
 * renames with no pin in mangle.json gets whatever short name is free, such
 * as `P` or `R`. On an element that belongs to someone else, a custom element
 * above all, a property of that name hides the element's own member of the
 * same name.
 *
 * So every property the framework sets on a node or an event has to be
 * pinned in mangle.json to a name that starts with two underscores, or kept
 * out of the rename list. This file puts an accessor on Node.prototype and
 * Event.prototype for each renamed name that has no pin. When the framework
 * sets one of them during a test file, the file fails and lists the names.
 *
 * It sees anything only on the builds that keep the source names (the dev and
 * unminified lanes). A production lane sets the renamed names, which have no
 * accessor here.
 */

import { afterAll, expect } from 'vitest'
import lists from '../../mangle-properties.json'
import cache from '../../mangle.json'

const pinned = cache.props.props
const unpinned = new Set(lists.mangle.filter((name) => !(('$' + name) in pinned)))
const found = new Set()
const define = Object.defineProperty

const guard = (proto, kind) => {
    for (const name of unpinned) {
        if (name in proto) continue
        define(proto, name, {
            configurable: true,
            get() { return undefined },
            set(value) {
                found.add(kind + ' ' + name)
                define(this, name, { value, writable: true, configurable: true, enumerable: true })
            },
        })
    }
}

guard(Node.prototype, 'node')
guard(Event.prototype, 'event')

// A property defined with Object.defineProperty does not go through a setter,
// so that call is watched as well.
Object.defineProperty = function (target, name, descriptor) {
    if (typeof name === 'string' && unpinned.has(name)) {
        if (target instanceof Node) found.add('node ' + name)
        else if (target instanceof Event) found.add('event ' + name)
    }
    return define(target, name, descriptor)
}

afterAll(() => {
    expect(
        [...found].sort(),
        'the framework set these on a DOM node or an event, and the production build renames them with no pin: add each to mangle.json as "$name": "__xx"'
    ).toEqual([])
})
