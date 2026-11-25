/**
 * A named template whose nested list uses the same template.
 *
 * A list's nested templates are resolved when the list is set up, one level
 * at a time, so a template that reaches itself (directly, or through another
 * template) has no last level. The list renders nothing in every build. A
 * development build says which template it is; the rest of the page is not
 * affected, and templates that are only shared, not nested in themselves,
 * render as before.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, hasFeature, isMinifiedBuild } from './helpers/load-framework.js'

const describeIfLists = hasFeature('lists') ? describe : describe.skip
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms))
let seq = 0

describeIfLists('a named template that uses itself', () => {
    let wildflower
    let container
    let errors
    let realError

    beforeAll(async () => {
        await loadFramework()
        wildflower = window.wildflower
    })

    beforeEach(() => {
        resetFramework()
        if (wildflower.diagnostics) wildflower.diagnostics.length = 0
        container = document.createElement('div')
        document.body.appendChild(container)
        errors = []
        realError = console.error
        console.error = (...args) => { errors.push(args.map(String).join(' ')) }
    })

    afterEach(() => {
        console.error = realError
        container.remove()
    })

    const mount = async (state, inner) => {
        const name = `tui-${++seq}`
        wildflower.component(name, { state })
        container.innerHTML = `<div data-component="${name}">${inner}</div>`
        wildflower.scan(container)
        await settle()
    }
    const texts = (sel) => [...container.querySelectorAll(sel)].map(e => e.textContent)
    const diagnostics = () => (wildflower.diagnostics || []).filter(d => d.code === 'WF-412')

    const TREE = [{ id: 1, name: 'root', children: [{ id: 2, name: 'child', children: [] }] }]
    const SELF = `
        <template data-item-template="node">
            <li><span class="node" data-bind="name"></span>
                <ul data-list="children" data-key="id"><template data-use-template="node"></template></ul>
            </li>
        </template>
        <ul data-list="tree" data-key="id"><template data-use-template="node"></template></ul>
        <ul data-list="plain" data-key="id"><template><li class="plain" data-bind="name"></li></template></ul>`

    it('the list renders nothing and the other lists on the page render', async () => {
        await mount({ tree: TREE, plain: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] }, SELF)
        expect(texts('.node')).toEqual([])
        expect(texts('.plain')).toEqual(['a', 'b'])
        expect(errors.some(line => line.includes('tree'))).toBe(true)
    })

    it.skipIf(isMinifiedBuild())('a development build names the template', async () => {
        await mount({ tree: TREE, plain: [] }, SELF)
        const found = diagnostics()
        expect(found.length).toBeGreaterThan(0)
        expect(found[0].context).toContain("'node'")
        expect(found[0].context).toContain('uses')
        expect(found[0].suggestion).toContain('depth')
        expect(errors.some(line => line.includes('Maximum call stack'))).toBe(false)
    })

    it.skipIf(isMinifiedBuild())('two templates that use each other are named the same way', async () => {
        await mount({ tree: TREE, plain: [] }, `
            <template data-item-template="odd">
                <li><span class="node" data-bind="name"></span>
                    <ul data-list="children" data-key="id"><template data-use-template="even"></template></ul>
                </li>
            </template>
            <template data-item-template="even">
                <li><span class="node" data-bind="name"></span>
                    <ul data-list="children" data-key="id"><template data-use-template="odd"></template></ul>
                </li>
            </template>
            <ul data-list="tree" data-key="id"><template data-use-template="odd"></template></ul>`)
        expect(texts('.node')).toEqual([])
        expect(diagnostics().length).toBeGreaterThan(0)
        expect(errors.some(line => line.includes('Maximum call stack'))).toBe(false)
    })

    it('a template shared by two lists and by a nested list of another template renders', async () => {
        await mount({
            groups: [{ id: 1, name: 'g1', members: [{ id: 11, name: 'm1' }, { id: 12, name: 'm2' }] }],
            people: [{ id: 21, name: 'p1' }],
            others: [{ id: 31, name: 'o1' }]
        }, `
            <template data-item-template="person"><li class="person" data-bind="name"></li></template>
            <template data-item-template="group">
                <li><span class="group" data-bind="name"></span>
                    <ul data-list="members" data-key="id"><template data-use-template="person"></template></ul>
                </li>
            </template>
            <ul data-list="groups" data-key="id"><template data-use-template="group"></template></ul>
            <ul data-list="people" data-key="id"><template data-use-template="person"></template></ul>
            <ul data-list="others" data-key="id"><template data-use-template="person"></template></ul>`)
        expect(texts('.group')).toEqual(['g1'])
        expect(texts('.person')).toEqual(['m1', 'm2', 'p1', 'o1'])
        expect(diagnostics()).toEqual([])
        expect(errors).toEqual([])
    })
})
