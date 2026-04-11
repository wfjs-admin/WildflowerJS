/**
 * WildflowerJS Nested Structure Edge Cases Test Suite - Vitest Browser Mode
 *
 * Tests for deeply nested state paths, nested lists with deep properties,
 * chained computed properties, and mixed nested bindings.
 * Migrated from unitTestSuite.js Nested Structure Edge Cases section.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Nested Structure Edge Cases', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    // Re-initialize the context system
    if (wildflower._initContextSystem) {
      wildflower._contextSystemInitialized = false
      wildflower._initContextSystem()
    }

    // Create test container
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

  it('deeply nested state object paths (5+ levels)', async () => {
    wildflower.component('deep-state-test', {
      state: {
        company: {
          headquarters: {
            address: {
              location: {
                city: 'San Francisco',
                zipCode: '94102',
                country: {
                  name: 'USA',
                  code: 'US'
                }
              }
            }
          }
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="deep-state-test">
        <span id="deep-city" data-bind="company.headquarters.address.location.city"></span>
        <span id="deep-zip" data-bind="company.headquarters.address.location.zipCode"></span>
        <span id="deep-country" data-bind="company.headquarters.address.location.country.name"></span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="deep-state-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial deep binding
    expect(testContainer.querySelector('#deep-city').textContent).toBe('San Francisco')
    expect(testContainer.querySelector('#deep-zip').textContent).toBe('94102')
    expect(testContainer.querySelector('#deep-country').textContent).toBe('USA')

    // Update deeply nested value
    instance.state.company.headquarters.address.location.city = 'Los Angeles'
    await waitForCompleteRender()

    expect(testContainer.querySelector('#deep-city').textContent).toBe('Los Angeles')

    // Update even deeper nested value
    instance.state.company.headquarters.address.location.country.name = 'Canada'
    await waitForCompleteRender()

    expect(testContainer.querySelector('#deep-country').textContent).toBe('Canada')
  })

  it('nested list with deep item properties', async () => {
    wildflower.component('nested-deep-list-test', {
      state: {
        deepDepartments: [
          { info: { details: { name: 'Engineering', head: { fullName: 'Alice Smith' } } } },
          { info: { details: { name: 'Marketing', head: { fullName: 'Bob Jones' } } } }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="nested-deep-list-test">
        <ul data-list="deepDepartments">
          <template>
            <li>
              <span class="dept-name" data-bind="info.details.name"></span>
              <span class="dept-head" data-bind="info.details.head.fullName"></span>
            </li>
          </template>
        </ul>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(100)

    const component = testContainer.querySelector('[data-component="nested-deep-list-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    const items = component.querySelectorAll('[data-list="deepDepartments"] li')
    expect(items.length).toBe(2)

    const names = component.querySelectorAll('.dept-name')
    const heads = component.querySelectorAll('.dept-head')

    expect(names[0].textContent).toBe('Engineering')
    expect(heads[0].textContent).toBe('Alice Smith')
    expect(names[1].textContent).toBe('Marketing')
    expect(heads[1].textContent).toBe('Bob Jones')

    // Update deep property in list item
    instance.state.deepDepartments[0].info.details.head.fullName = 'Carol White'
    await waitForCompleteRender()
    await waitForUpdate(100)

    // Re-query after update
    const updatedHeads = component.querySelectorAll('.dept-head')
    expect(updatedHeads[0].textContent).toBe('Carol White')
  })

  it('three-level nested list with actions', async () => {
    let firedEmployees = []

    wildflower.component('three-level-action-test', {
      state: {
        threeCompanies: [
          {
            name: 'TechCorp',
            threeDepartments: [
              {
                name: 'Engineering',
                threeEmployees: [
                  { name: 'Alice' },
                  { name: 'Bob' }
                ]
              }
            ]
          }
        ]
      },
      fireEmployee(event, element, details) {
        firedEmployees.push(details)
      }
    })

    testContainer.innerHTML = `
      <div data-component="three-level-action-test">
        <div data-list="threeCompanies" class="companies">
          <template>
            <div class="company">
              <span class="company-name" data-bind="name"></span>
              <div data-list="threeDepartments" class="departments">
                <template>
                  <div class="department">
                    <span class="dept-name" data-bind="name"></span>
                    <ul data-list="threeEmployees" class="employees">
                      <template>
                        <li class="employee">
                          <span class="emp-name" data-bind="name"></span>
                          <button class="fire-btn" data-action="fireEmployee">Fire</button>
                        </li>
                      </template>
                    </ul>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate(150)

    const component = testContainer.querySelector('[data-component="three-level-action-test"]')

    // Verify three-level nesting rendered
    const companies = component.querySelectorAll('.company')
    expect(companies.length).toBe(1)

    const departments = component.querySelectorAll('.department')
    expect(departments.length).toBe(1)

    const employees = component.querySelectorAll('.employee')
    expect(employees.length).toBe(2)

    // Click fire button on second employee
    const fireButtons = component.querySelectorAll('.fire-btn')
    expect(fireButtons.length).toBe(2)

    fireButtons[1].click()
    await waitForUpdate()

    expect(firedEmployees.length).toBe(1)
    expect(firedEmployees[0]).toBeDefined()
  })

  it('chained computed properties across nesting levels', async () => {
    wildflower.component('chained-computed-test', {
      state: {
        baseValue: 5,
        multiplier: 2
      },
      computed: {
        doubled() {
          return this.state.baseValue * 2
        },
        quadrupled() {
          // Depends on doubled computed
          return this.computed.doubled * 2
        },
        final() {
          // Depends on quadrupled and multiplier
          return this.computed.quadrupled * this.state.multiplier
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="chained-computed-test">
        <span id="base-val" data-bind="baseValue"></span>
        <span id="doubled" data-bind="computed:doubled"></span>
        <span id="quadrupled" data-bind="computed:quadrupled"></span>
        <span id="final" data-bind="computed:final"></span>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="chained-computed-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify initial computed chain: 5 -> 10 -> 20 -> 40
    expect(testContainer.querySelector('#base-val').textContent).toBe('5')
    expect(testContainer.querySelector('#doubled').textContent).toBe('10')
    expect(testContainer.querySelector('#quadrupled').textContent).toBe('20')
    expect(testContainer.querySelector('#final').textContent).toBe('40')

    // Change base value - should cascade through all computed
    instance.state.baseValue = 10
    await waitForCompleteRender()
    await waitForUpdate(100)

    // Verify cascade: 10 -> 20 -> 40 -> 80
    expect(testContainer.querySelector('#doubled').textContent).toBe('20')
    expect(testContainer.querySelector('#quadrupled').textContent).toBe('40')
    expect(testContainer.querySelector('#final').textContent).toBe('80')
  })

  it('mixed nested bindings and conditionals (data-show)', async () => {
    wildflower.component('mixed-nested-test', {
      state: {
        isActive: true,
        showAddress: true,
        user: {
          profile: {
            name: 'John Doe',
            address: {
              city: 'New York'
            }
          }
        }
      }
    })

    testContainer.innerHTML = `
      <div data-component="mixed-nested-test">
        <div id="active-section" data-show="isActive">
          <span id="user-name" data-bind="user.profile.name"></span>
          <div id="address-section" data-show="showAddress">
            <span id="user-city" data-bind="user.profile.address.city"></span>
          </div>
        </div>
        <div id="inactive-section" data-show="!isActive">
          <span id="inactive-msg">User is inactive</span>
        </div>
      </div>
    `

    wildflower.scan()
    await waitForUpdate()

    const component = testContainer.querySelector('[data-component="mixed-nested-test"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Verify nested bindings show correct content
    const userName = testContainer.querySelector('#user-name')
    const userCity = testContainer.querySelector('#user-city')

    expect(userName.textContent).toBe('John Doe')
    expect(userCity.textContent).toBe('New York')

    // Toggle inner conditional (address section)
    instance.state.showAddress = false
    await waitForCompleteRender()

    // Address section should be hidden
    const addressSection = testContainer.querySelector('#address-section')
    expect(addressSection.style.display).toBe('none')

    // Toggle outer conditional
    instance.state.isActive = false
    await waitForCompleteRender()

    // Active section should be hidden
    const activeSection = testContainer.querySelector('#active-section')
    expect(activeSection.style.display).toBe('none')

    // Inactive section should be visible
    const inactiveSection = testContainer.querySelector('#inactive-section')
    expect(inactiveSection.style.display).not.toBe('none')
  })
})
