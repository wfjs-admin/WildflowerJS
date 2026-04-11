/**
 * Multi-Level Composition Test Suite
 *
 * Tests list → component → list nesting (2-3 levels deep). The pattern where
 * list items contain components that themselves render lists. This is the
 * foundation of every real-world hierarchical UI.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

let counter = 0
function unique(prefix) { return `${prefix}-${++counter}` }

describe('Multi-Level Composition', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  it('2-level: parent list renders child components, each with inner list', async () => {
    const cn = unique('mlc-parent')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="categories">
          <template>
            <div class="category">
              <h3 class="cat-name" data-bind="name"></h3>
              <div data-list="items">
                <template>
                  <span class="cat-item" data-bind="label"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        categories: [
          { id: 1, name: 'Fruits', items: [
            { id: 1, label: 'Apple' }, { id: 2, label: 'Banana' }
          ]},
          { id: 2, name: 'Vegs', items: [
            { id: 3, label: 'Carrot' }
          ]}
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const cats = testContainer.querySelectorAll('.category')
    expect(cats.length).toBe(2)

    const cat1Items = cats[0].querySelectorAll('.cat-item')
    expect(cat1Items.length).toBe(2)
    expect(cat1Items[0].textContent).toBe('Apple')

    const cat2Items = cats[1].querySelectorAll('.cat-item')
    expect(cat2Items.length).toBe(1)
    expect(cat2Items[0].textContent).toBe('Carrot')
  })

  it('inner list items bind correctly to their own data (not parent data)', async () => {
    const cn = unique('mlc-scope')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="groups">
          <template>
            <div class="group">
              <span class="group-name" data-bind="name"></span>
              <div data-list="members">
                <template>
                  <span class="member-name" data-bind="name"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        groups: [
          { id: 1, name: 'Team Alpha', members: [
            { id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }
          ]},
          { id: 2, name: 'Team Beta', members: [
            { id: 3, name: 'Carol' }
          ]}
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Group names should show group-level data
    const groupNames = testContainer.querySelectorAll('.group-name')
    expect(groupNames[0].textContent).toBe('Team Alpha')
    expect(groupNames[1].textContent).toBe('Team Beta')

    // Member names should show member-level data, NOT group name
    const members = testContainer.querySelectorAll('.member-name')
    expect(members[0].textContent).toBe('Alice')
    expect(members[1].textContent).toBe('Bob')
    expect(members[2].textContent).toBe('Carol')
  })

  it('mutate inner list item property → only that item updates', async () => {
    const cn = unique('mlc-inner-mutate')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="sections">
          <template>
            <div class="section">
              <div data-list="rows">
                <template>
                  <span class="row-val" data-bind="value"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        sections: [
          { id: 1, rows: [
            { id: 1, value: 'A1' }, { id: 2, value: 'A2' }
          ]},
          { id: 2, rows: [
            { id: 3, value: 'B1' }
          ]}
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Mutate one inner item
    componentRef.state.sections[0].rows[1].value = 'A2-updated'
    await waitForCompleteRender()

    const vals = testContainer.querySelectorAll('.row-val')
    expect(vals[0].textContent).toBe('A1') // unchanged
    expect(vals[1].textContent).toBe('A2-updated') // updated
    expect(vals[2].textContent).toBe('B1') // unchanged
  })

  it('add item to inner list → inner list grows, outer list unchanged', async () => {
    const cn = unique('mlc-inner-add')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="containers">
          <template>
            <div class="container">
              <span class="container-label" data-bind="label"></span>
              <div data-list="children">
                <template>
                  <span class="child" data-bind="text"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        containers: [
          { id: 1, label: 'Box 1', children: [{ id: 1, text: 'Item 1' }] },
          { id: 2, label: 'Box 2', children: [{ id: 2, text: 'Item 2' }] }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.container').length).toBe(2)
    expect(testContainer.querySelectorAll('.child').length).toBe(2)

    // Add to inner list of first container
    componentRef.state.containers[0].children.push({ id: 3, text: 'Item 3' })
    await waitForCompleteRender()

    // Outer list should be unchanged (still 2 containers)
    expect(testContainer.querySelectorAll('.container').length).toBe(2)
    // Inner list of first container should have grown
    const box1Children = testContainer.querySelectorAll('.container')[0].querySelectorAll('.child')
    expect(box1Children.length).toBe(2)
    expect(box1Children[1].textContent).toBe('Item 3')
  })

  it('remove item from outer list → inner components cleaned up', async () => {
    const cn = unique('mlc-outer-remove')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="panels">
          <template>
            <div class="panel">
              <span class="panel-title" data-bind="title"></span>
              <div data-list="widgets">
                <template>
                  <span class="widget" data-bind="name"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        panels: [
          { id: 1, title: 'Panel A', widgets: [{ id: 1, name: 'W1' }, { id: 2, name: 'W2' }] },
          { id: 2, title: 'Panel B', widgets: [{ id: 3, name: 'W3' }] },
          { id: 3, title: 'Panel C', widgets: [{ id: 4, name: 'W4' }] }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.panel').length).toBe(3)
    expect(testContainer.querySelectorAll('.widget').length).toBe(4)

    // Remove middle panel
    componentRef.state.panels.splice(1, 1)
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.panel').length).toBe(2)
    // Panel B's widget (W3) should be gone
    const panelTitles = testContainer.querySelectorAll('.panel-title')
    expect(panelTitles[0].textContent).toBe('Panel A')
    expect(panelTitles[1].textContent).toBe('Panel C')
  })

  it('3-level: board → columns → cards (each level a nested list)', async () => {
    const cn = unique('mlc-3level')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="boards">
          <template>
            <div class="board">
              <span class="board-name" data-bind="name"></span>
              <div data-list="columns">
                <template>
                  <div class="column">
                    <span class="col-name" data-bind="name"></span>
                    <div data-list="cards">
                      <template>
                        <span class="card" data-bind="title"></span>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        boards: [
          {
            id: 1, name: 'Board 1',
            columns: [
              { id: 1, name: 'Todo', cards: [
                { id: 1, title: 'Card A' },
                { id: 2, title: 'Card B' }
              ]},
              { id: 2, name: 'Done', cards: [
                { id: 3, title: 'Card C' }
              ]}
            ]
          }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.board').length).toBe(1)
    expect(testContainer.querySelectorAll('.column').length).toBe(2)
    expect(testContainer.querySelectorAll('.card').length).toBe(3)
    expect(testContainer.querySelector('.board-name').textContent).toBe('Board 1')
  })

  it('mutate data at level 3 → renders correctly without affecting level 1 or 2', async () => {
    const cn = unique('mlc-deep-mutate')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="orgs">
          <template>
            <div class="org">
              <span class="org-name" data-bind="name"></span>
              <div data-list="teams">
                <template>
                  <div class="team">
                    <span class="team-name" data-bind="name"></span>
                    <div data-list="people">
                      <template>
                        <span class="person" data-bind="name"></span>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        orgs: [{
          id: 1, name: 'Acme',
          teams: [{
            id: 1, name: 'Engineering',
            people: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' }
            ]
          }]
        }]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Mutate level 3
    componentRef.state.orgs[0].teams[0].people[0].name = 'Alicia'
    await waitForCompleteRender()

    // Level 3 updated
    expect(testContainer.querySelectorAll('.person')[0].textContent).toBe('Alicia')
    // Level 1 and 2 unchanged
    expect(testContainer.querySelector('.org-name').textContent).toBe('Acme')
    expect(testContainer.querySelector('.team-name').textContent).toBe('Engineering')
  })

  it('add item at level 2 → new item at level 2 with its own level 3 list', async () => {
    const cn = unique('mlc-add-l2')
    let componentRef

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="departments">
          <template>
            <div class="dept">
              <span class="dept-name" data-bind="name"></span>
              <div data-list="employees">
                <template>
                  <span class="emp" data-bind="name"></span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        departments: [
          { id: 1, name: 'Sales', employees: [{ id: 1, name: 'Dana' }] }
        ]
      },
      init() { componentRef = this }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.dept').length).toBe(1)
    expect(testContainer.querySelectorAll('.emp').length).toBe(1)

    // Add department with its own employees
    componentRef.state.departments.push({
      id: 2, name: 'Marketing', employees: [
        { id: 2, name: 'Eve' }, { id: 3, name: 'Frank' }
      ]
    })
    await waitForCompleteRender()

    expect(testContainer.querySelectorAll('.dept').length).toBe(2)
    const depts = testContainer.querySelectorAll('.dept')
    const newDeptEmps = depts[1].querySelectorAll('.emp')
    expect(newDeptEmps.length).toBe(2)
    expect(newDeptEmps[0].textContent).toBe('Eve')
    expect(newDeptEmps[1].textContent).toBe('Frank')
  })

  it('component in list receives props from list item', async () => {
    const parentCn = unique('mlc-props-parent')
    const childCn = unique('mlc-props-child')

    wildflower.component(childCn, {
      state: {
        greeting: 'Hello'
      }
    })

    testContainer.innerHTML = `
      <div data-component="${parentCn}">
        <div data-list="users">
          <template>
            <div data-component="${childCn}" data-bind-attr="({ 'data-user-name': name })">
              <span class="user-greeting" data-bind="greeting"></span>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(parentCn, {
      state: {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    const children = testContainer.querySelectorAll(`[data-component="${childCn}"]`)
    expect(children.length).toBe(2)
    // Each child component should have the attribute from the list item
    expect(children[0].getAttribute('data-user-name')).toBe('Alice')
    expect(children[1].getAttribute('data-user-name')).toBe('Bob')
    // Each child's internal binding should use component state, not list context
    const greetings = testContainer.querySelectorAll('.user-greeting')
    expect(greetings[0].textContent).toBe('Hello')
    expect(greetings[1].textContent).toBe('Hello')
  })

  it('multiple binding types at each nesting level', async () => {
    const cn = unique('mlc-multi-bind')

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <div data-list="sections">
          <template>
            <div class="section">
              <h3 class="section-title" data-bind="title"></h3>
              <div class="section-badge" data-show="hasItems">
                <div data-list="items">
                  <template>
                    <div class="item">
                      <span class="item-name" data-bind="name"></span>
                      <span class="item-status" data-show="active">Active</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(cn, {
      state: {
        sections: [
          {
            id: 1, title: 'Section 1', hasItems: true,
            items: [
              { id: 1, name: 'Item A', active: true },
              { id: 2, name: 'Item B', active: false }
            ]
          },
          {
            id: 2, title: 'Section 2', hasItems: false,
            items: []
          }
        ]
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    // Section titles
    const titles = testContainer.querySelectorAll('.section-title')
    expect(titles[0].textContent).toBe('Section 1')
    expect(titles[1].textContent).toBe('Section 2')

    // data-show on section badge
    const badges = testContainer.querySelectorAll('.section-badge')
    expect(badges[0].classList.contains('wf-show')).toBe(true)
    expect(badges[1].classList.contains('wf-show')).toBe(false)

    // Inner items
    const items = testContainer.querySelectorAll('.item')
    expect(items.length).toBe(2)

    // data-show on inner items
    const statuses = testContainer.querySelectorAll('.item-status')
    expect(statuses[0].classList.contains('wf-show')).toBe(true)
    expect(statuses[1].classList.contains('wf-show')).toBe(false)
  })
})
