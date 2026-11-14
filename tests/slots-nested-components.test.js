/**
 * Slots when the component that has them sits inside another component.
 *
 * A component fills its own slot containers with its own slot content. A
 * component around it has no part in that: it must not take a slot that
 * belongs to a component inside it, and its own containers must not be
 * filled from one.
 *
 * (Slot processing searched a component's whole subtree for containers and
 * for content. With three panels inside a page component, the page gave the
 * first panel's content to the last panel, the last panel's own content was
 * never placed, and the first panel stayed empty.)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms))

let seq = 0
const uname = (p) => `${p}-sn-${++seq}`

describe('Slots: a component with slots inside another component', () => {
  let host
  let wildflower

  beforeAll(async () => { await loadFramework() })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }
    host = document.createElement('div')
    host.style.cssText = 'position: absolute; left: -9999px;'
    document.body.appendChild(host)
  })

  afterEach(() => { host.remove() })

  const panel = (name, title, slots) => `
    <div class="panel" data-component="${name}" data-title="${title}">
      <span class="badge-hole" data-slot-container="badge"></span>
      <div class="body-hole" data-slot-container="body"></div>
      ${slots}
    </div>`

  // What each panel's two containers hold, by the panel's title.
  const held = () => Object.fromEntries([...host.querySelectorAll('.panel')].map((p) => [
    p.dataset.title,
    {
      badge: p.querySelector('.badge-hole').textContent.trim(),
      body: p.querySelector('.body-hole').textContent.trim(),
      // Slot content still sitting where it was written, outside any container.
      unplaced: [...p.querySelectorAll('[data-slot]')].filter((s) => !s.parentElement.hasAttribute('data-slot-container')).length,
    },
  ]))

  const THREE = (name) =>
    panel(name, 'Profile', '<div data-slot="body">name field</div>') +
    panel(name, 'Notifications', '<div data-slot="badge">3</div><div data-slot="body">email toggle</div>') +
    panel(name, 'Danger', '<div data-slot="body">delete button</div>')

  const EXPECTED = {
    Profile: { badge: '', body: 'name field', unplaced: 0 },
    Notifications: { badge: '3', body: 'email toggle', unplaced: 0 },
    Danger: { badge: '', body: 'delete button', unplaced: 0 },
  }

  it('three panels on their own each keep their own slots', async () => {
    const name = uname('panel')
    wildflower.component(name, { state: {} })
    host.innerHTML = THREE(name)
    wildflower.scan()
    await settle()
    expect(held()).toEqual(EXPECTED)
  })

  it('three panels inside a page component each keep their own slots', async () => {
    const name = uname('panel'); const page = uname('page')
    wildflower.component(name, { state: {} })
    wildflower.component(page, { state: {} })
    host.innerHTML = `<div data-component="${page}">${THREE(name)}</div>`
    wildflower.scan()
    await settle()
    expect(held()).toEqual(EXPECTED)
  })

  it('a page with a slot of its own fills it, and the panels inside keep theirs', async () => {
    const name = uname('panel'); const page = uname('page')
    wildflower.component(name, { state: {} })
    wildflower.component(page, { state: {} })
    host.innerHTML = `
      <div data-component="${page}">
        <header class="page-hole" data-slot-container="body"></header>
        ${THREE(name)}
        <div data-slot="body">page heading</div>
      </div>`
    wildflower.scan()
    await settle()
    expect(host.querySelector('.page-hole').textContent.trim()).toBe('page heading')
    expect(held()).toEqual(EXPECTED)
  })

  it('a component inside slot content fills its own containers', async () => {
    const outer = uname('outer'); const inner = uname('inner')
    wildflower.component(outer, { state: {} })
    wildflower.component(inner, { state: {} })
    host.innerHTML = `
      <div data-component="${outer}">
        <div class="outer-hole" data-slot-container="body"></div>
        <div data-slot="body">
          <div data-component="${inner}">
            <div class="inner-hole" data-slot-container="body"></div>
            <div data-slot="body">inner content</div>
          </div>
        </div>
      </div>`
    wildflower.scan()
    await settle()
    const outerHole = host.querySelector('.outer-hole')
    const innerHole = host.querySelector('.inner-hole')
    expect(outerHole.contains(innerHole), 'the outer container holds the inner component').toBe(true)
    expect(innerHole.textContent.trim()).toBe('inner content')
    expect(outerHole.firstElementChild.getAttribute('data-slot'), 'the outer container holds the outer slot').toBe('body')
  })
})
