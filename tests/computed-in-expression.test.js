/**
 * Test: data-bind expressions that reference computed properties
 *
 * Reproduces the bug from the conditionals doc page where the
 * "Current Permissions Matrix" table uses expressions like:
 *   data-bind="canViewDashboard ? '✅ Yes' : '❌ No'"
 * where canViewDashboard is a computed property.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework } from './helpers/load-framework.js'

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('data-bind expressions referencing computed properties', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower

    if (wildflower.componentDefinitions) {
      wildflower.componentDefinitions.clear()
    }
    if (wildflower.componentInstances) {
      wildflower.componentInstances.clear()
    }
    if (wildflower._templateCache) {
      if (wildflower._templateCache.general) wildflower._templateCache.general.clear()
      if (wildflower._templateCache.lists) wildflower._templateCache.lists.clear()
      if (wildflower._templateCache.compiled) wildflower._templateCache.compiled.clear()
      if (wildflower._templateCache.extracted) wildflower._templateCache.extracted.clear()
      if (wildflower._templateCache.fragmentPools) wildflower._templateCache.fragmentPools.clear()
      if (wildflower._templateCache.stats) wildflower._templateCache.stats.clear()
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

  // --- Direct DOM tests (baseline) ---

  it('ternary expression using a computed property shows correct initial value', async () => {
    testContainer.innerHTML = `
      <div data-component="computed-expr-test">
        <span id="result" data-bind="isActive ? 'Yes' : 'No'"></span>
      </div>
    `

    wildflower.component('computed-expr-test', {
      state: {
        status: 'active'
      },
      computed: {
        isActive() {
          return this.status === 'active'
        }
      }
    })

    await waitForCompleteRender()

    const result = testContainer.querySelector('#result')
    expect(result.textContent).toBe('Yes')
  })

  it('ternary expression using computed property updates when state changes', async () => {
    testContainer.innerHTML = `
      <div data-component="computed-expr-update">
        <span id="result" data-bind="isActive ? 'Yes' : 'No'"></span>
      </div>
    `

    wildflower.component('computed-expr-update', {
      state: {
        status: 'active'
      },
      computed: {
        isActive() {
          return this.status === 'active'
        }
      }
    })

    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="computed-expr-update"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)
    const result = testContainer.querySelector('#result')

    expect(result.textContent).toBe('Yes')

    // Change state so computed becomes false
    instance.state.status = 'inactive'
    await waitForCompleteRender()

    expect(result.textContent).toBe('No')
  })

  it('multiple computed properties in expression (permissions pattern)', async () => {
    testContainer.innerHTML = `
      <div data-component="permissions-test">
        <span id="dashboard" data-bind="canViewDashboard ? 'Allowed' : 'Denied'"></span>
        <span id="admin" data-bind="isAdmin ? 'Allowed' : 'Denied'"></span>
      </div>
    `

    wildflower.component('permissions-test', {
      state: {
        userRole: 'admin',
        accountStatus: 'active'
      },
      computed: {
        isUser() {
          return ['user', 'admin', 'superadmin'].includes(this.userRole)
        },
        isAdmin() {
          return ['admin', 'superadmin'].includes(this.userRole)
        },
        isAccountActive() {
          return this.accountStatus === 'active'
        },
        canViewDashboard() {
          return this.isUser && this.isAccountActive
        }
      }
    })

    await waitForCompleteRender()

    expect(testContainer.querySelector('#dashboard').textContent).toBe('Allowed')
    expect(testContainer.querySelector('#admin').textContent).toBe('Allowed')
  })

  it('computed property in expression with emoji string literals', async () => {
    testContainer.innerHTML = `
      <div data-component="emoji-expr-test">
        <span id="result" data-bind="isActive ? '✅ Yes' : '❌ No'"></span>
      </div>
    `

    wildflower.component('emoji-expr-test', {
      state: {
        status: 'active'
      },
      computed: {
        isActive() {
          return this.status === 'active'
        }
      }
    })

    await waitForCompleteRender()

    expect(testContainer.querySelector('#result').textContent).toBe('✅ Yes')
  })

  it('computed property in expression updates reactively after state mutation', async () => {
    testContainer.innerHTML = `
      <div data-component="reactive-computed-expr">
        <span id="dashboard" data-bind="canViewDashboard ? 'Allowed' : 'Denied'"></span>
      </div>
    `

    wildflower.component('reactive-computed-expr', {
      state: {
        userRole: 'guest',
        accountStatus: 'active'
      },
      computed: {
        isUser() {
          return ['user', 'admin'].includes(this.userRole)
        },
        isAccountActive() {
          return this.accountStatus === 'active'
        },
        canViewDashboard() {
          return this.isUser && this.isAccountActive
        }
      }
    })

    await waitForCompleteRender()

    const component = testContainer.querySelector('[data-component="reactive-computed-expr"]')
    const instance = wildflower.componentInstances.get(component.dataset.componentId)

    // Guest role -> canViewDashboard is false
    expect(testContainer.querySelector('#dashboard').textContent).toBe('Denied')

    // Promote to admin -> canViewDashboard becomes true
    instance.state.userRole = 'admin'
    await waitForCompleteRender()

    expect(testContainer.querySelector('#dashboard').textContent).toBe('Allowed')
  })

  // --- Reproduces the exact docs page bug: data-model + data-show + expression ---

  describe('docs page reproduction: data-model triggers expression blanking', () => {
    it('expression bindings survive state change via data-model select', async () => {
      // This matches the conditionals page pattern:
      // data-model selects, data-show conditionals, AND expression data-binds
      testContainer.innerHTML = `
        <div data-component="model-expr-repro">
          <select id="role-select" data-model="userRole">
            <option value="guest">Guest</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <div data-show="canViewDashboard" id="dashboard-panel">Dashboard visible</div>
          <table>
            <tr>
              <td><span id="access" data-bind="canViewDashboard ? 'Yes' : 'No'"></span></td>
              <td><span id="role-display" data-bind="userRole"></span></td>
            </tr>
          </table>
        </div>
      `

      wildflower.component('model-expr-repro', {
        state: {
          userRole: 'guest',
          accountStatus: 'active'
        },
        computed: {
          isUser() { return ['user', 'admin'].includes(this.userRole) },
          isAccountActive() { return this.accountStatus === 'active' },
          canViewDashboard() { return this.isUser && this.isAccountActive }
        }
      })

      await waitForCompleteRender()

      // Initial state: guest -> canViewDashboard is false
      expect(testContainer.querySelector('#access').textContent).toBe('No')
      expect(testContainer.querySelector('#role-display').textContent).toBe('guest')

      // Simulate user changing the select dropdown (like on the docs page)
      const select = testContainer.querySelector('#role-select')
      select.value = 'admin'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForCompleteRender()

      // After changing to admin, expression should update
      expect(testContainer.querySelector('#role-display').textContent).toBe('admin')
      expect(testContainer.querySelector('#access').textContent).toBe('Yes')
    })

    it('expression bindings survive action method that sets multiple state properties', async () => {
      // The docs page uses quick-action buttons like setAdmin() that set multiple properties
      testContainer.innerHTML = `
        <div data-component="action-expr-repro">
          <button id="set-admin" data-action="setAdmin">Admin</button>
          <button id="set-guest" data-action="setGuestUser">Guest</button>
          <div data-show="canViewDashboard" id="dashboard-panel">Dashboard</div>
          <div data-show="isAdmin" id="admin-panel">Admin Panel</div>
          <span id="access" data-bind="canViewDashboard ? 'Yes' : 'No'"></span>
          <span id="admin-access" data-bind="isAdmin ? 'Yes' : 'No'"></span>
        </div>
      `

      wildflower.component('action-expr-repro', {
        state: {
          userRole: 'guest',
          accountStatus: 'active',
          subscription: 'free'
        },
        computed: {
          isUser() { return ['user', 'admin', 'superadmin'].includes(this.userRole) },
          isAdmin() { return ['admin', 'superadmin'].includes(this.userRole) },
          isAccountActive() { return this.accountStatus === 'active' },
          canViewDashboard() { return this.isUser && this.isAccountActive }
        },
        setAdmin() {
          this.userRole = 'admin'
          this.accountStatus = 'active'
          this.subscription = 'pro'
        },
        setGuestUser() {
          this.userRole = 'guest'
          this.accountStatus = 'active'
          this.subscription = 'free'
        }
      })

      await waitForCompleteRender()

      // Initial: guest
      expect(testContainer.querySelector('#access').textContent).toBe('No')
      expect(testContainer.querySelector('#admin-access').textContent).toBe('No')

      // Click "Admin" button
      testContainer.querySelector('#set-admin').click()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#access').textContent).toBe('Yes')
      expect(testContainer.querySelector('#admin-access').textContent).toBe('Yes')

      // Click "Guest" button - go back
      testContainer.querySelector('#set-guest').click()
      await waitForCompleteRender()

      expect(testContainer.querySelector('#access').textContent).toBe('No')
      expect(testContainer.querySelector('#admin-access').textContent).toBe('No')
    })

    it('expression bindings in scanned component survive data-model change', async () => {
      // Full reproduction: innerHTML round-trip + scan + data-model change
      const htmlCode = `<div data-component="scan-model-repro" data-external>
        <select id="role-select" data-model="userRole">
          <option value="guest">Guest</option>
          <option value="admin">Admin</option>
        </select>
        <div data-show="canViewDashboard">Dashboard</div>
        <span id="access" data-bind="canViewDashboard ? 'Yes' : 'No'"></span>
        <span id="admin-badge" data-bind="isAdmin ? 'Yes' : 'No'"></span>
      </div>`

      // innerHTML round-trip
      const temp = document.createElement('div')
      temp.innerHTML = htmlCode
      temp.querySelectorAll('[data-component]').forEach(el => el.setAttribute('data-external', ''))
      testContainer.innerHTML = temp.innerHTML

      wildflower.component('scan-model-repro', {
        state: { userRole: 'guest', accountStatus: 'active' },
        computed: {
          isUser() { return ['user', 'admin'].includes(this.userRole) },
          isAdmin() { return ['admin', 'superadmin'].includes(this.userRole) },
          isAccountActive() { return this.accountStatus === 'active' },
          canViewDashboard() { return this.isUser && this.isAccountActive }
        }
      })

      wildflower.scan(testContainer)
      await waitForCompleteRender()

      // Initial: guest
      expect(testContainer.querySelector('#access').textContent).toBe('No')
      expect(testContainer.querySelector('#admin-badge').textContent).toBe('No')

      // Change select to admin
      const select = testContainer.querySelector('#role-select')
      select.value = 'admin'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForCompleteRender()

      // Expression bindings should update — THIS is the bug
      expect(testContainer.querySelector('#access').textContent).toBe('Yes')
      expect(testContainer.querySelector('#admin-badge').textContent).toBe('Yes')
    })
  })

  // --- Natural render cycle (no _forceCompleteRender) ---

  describe('natural render cycle (no forceRender)', () => {
    it('expression bindings survive state change via natural rAF cycle', async () => {
      testContainer.innerHTML = `
        <div data-component="natural-cycle-test">
          <span id="role-display" data-bind="userRole"></span>
          <span id="access" data-bind="canViewDashboard ? 'Yes' : 'No'"></span>
          <span id="admin-badge" data-bind="isAdmin ? 'Yes' : 'No'"></span>
        </div>
      `

      wildflower.component('natural-cycle-test', {
        state: { userRole: 'guest', accountStatus: 'active' },
        computed: {
          isUser() { return ['user', 'admin'].includes(this.userRole) },
          isAdmin() { return ['admin', 'superadmin'].includes(this.userRole) },
          isAccountActive() { return this.accountStatus === 'active' },
          canViewDashboard() { return this.isUser && this.isAccountActive }
        }
      })

      // Wait for initial render (natural cycle)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(resolve, 50)
      })))

      const component = testContainer.querySelector('[data-component="natural-cycle-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      expect(testContainer.querySelector('#access').textContent).toBe('No')
      expect(testContainer.querySelector('#admin-badge').textContent).toBe('No')

      // Change state directly (no _forceCompleteRender)
      instance.state.userRole = 'admin'

      // Wait for natural render cycle: microtask (effect) then rAF (legacy)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(resolve, 50)
      })))

      // Expression bindings should survive the Effect + legacy render cycle
      expect(testContainer.querySelector('#role-display').textContent).toBe('admin')
      expect(testContainer.querySelector('#access').textContent).toBe('Yes')
      expect(testContainer.querySelector('#admin-badge').textContent).toBe('Yes')
    })

    it('expression bindings survive multiple sequential state changes', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-change-test">
          <span id="access" data-bind="canViewDashboard ? 'Yes' : 'No'"></span>
        </div>
      `

      wildflower.component('multi-change-test', {
        state: { userRole: 'guest', accountStatus: 'active' },
        computed: {
          isUser() { return ['user', 'admin'].includes(this.userRole) },
          isAccountActive() { return this.accountStatus === 'active' },
          canViewDashboard() { return this.isUser && this.isAccountActive }
        }
      })

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(resolve, 50)
      })))

      const component = testContainer.querySelector('[data-component="multi-change-test"]')
      const instance = wildflower.componentInstances.get(component.dataset.componentId)

      expect(testContainer.querySelector('#access').textContent).toBe('No')

      // Change 1: guest -> admin
      instance.state.userRole = 'admin'
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(resolve, 50)
      })))
      expect(testContainer.querySelector('#access').textContent).toBe('Yes')

      // Change 2: admin -> guest
      instance.state.userRole = 'guest'
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(resolve, 50)
      })))
      expect(testContainer.querySelector('#access').textContent).toBe('No')

      // Change 3: guest -> user
      instance.state.userRole = 'user'
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(resolve, 50)
      })))
      expect(testContainer.querySelector('#access').textContent).toBe('Yes')
    })
  })

  // --- Mimics the codeExample innerHTML round-trip pipeline ---

  describe('innerHTML round-trip (codeExample pipeline)', () => {
    it('expression with computed property survives innerHTML round-trip + scan', async () => {
      // This mimics what codeExample does:
      // 1. Extract HTML from <code> textContent
      // 2. Round-trip through innerHTML (addDataExternalToComponents)
      // 3. Set as preview innerHTML
      // 4. eval() the JS
      // 5. wildflower.scan() the preview

      const htmlCode = `<div data-component="roundtrip-test" data-external>
        <span id="result" data-bind="isActive ? 'Yes' : 'No'"></span>
      </div>`

      // Step 2: innerHTML round-trip (like addDataExternalToComponents)
      const tempContainer = document.createElement('div')
      tempContainer.innerHTML = htmlCode
      const componentElements = tempContainer.querySelectorAll('[data-component]')
      componentElements.forEach(el => el.setAttribute('data-external', ''))
      const roundTrippedHtml = tempContainer.innerHTML

      // Step 3: Set preview content
      testContainer.innerHTML = roundTrippedHtml

      // Step 4: Register component
      wildflower.component('roundtrip-test', {
        state: { status: 'active' },
        computed: {
          isActive() { return this.status === 'active' }
        }
      })

      // Step 5: Scan
      wildflower.scan(testContainer)
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('Yes')
    })

    it('permissions-style expressions survive innerHTML round-trip + scan', async () => {
      const htmlCode = `<div data-component="roundtrip-perms" data-external>
        <table>
          <tr>
            <td>Dashboard</td>
            <td><span id="dashboard" data-bind="canViewDashboard ? '✅ Yes' : '❌ No'" class="badge"></span></td>
          </tr>
          <tr>
            <td>Admin</td>
            <td><span id="admin" data-bind="isAdmin ? '✅ Yes' : '❌ No'" class="badge"></span></td>
          </tr>
        </table>
      </div>`

      // innerHTML round-trip
      const tempContainer = document.createElement('div')
      tempContainer.innerHTML = htmlCode
      tempContainer.querySelectorAll('[data-component]').forEach(el => el.setAttribute('data-external', ''))
      testContainer.innerHTML = tempContainer.innerHTML

      // Register component
      wildflower.component('roundtrip-perms', {
        state: {
          userRole: 'admin',
          accountStatus: 'active'
        },
        computed: {
          isUser() { return ['user', 'admin', 'superadmin'].includes(this.userRole) },
          isAdmin() { return ['admin', 'superadmin'].includes(this.userRole) },
          isAccountActive() { return this.accountStatus === 'active' },
          canViewDashboard() { return this.isUser && this.isAccountActive }
        }
      })

      // Scan
      wildflower.scan(testContainer)
      await waitForCompleteRender()

      expect(testContainer.querySelector('#dashboard').textContent).toBe('✅ Yes')
      expect(testContainer.querySelector('#admin').textContent).toBe('✅ Yes')
    })

    it('textContent extraction from code block mimics codeExample pipeline', async () => {
      // This test exactly mimics how codeExample extracts code:
      // The <code> block contains HTML-entity-encoded content

      // Create a <pre><code> block like in the docs page
      const codeBlock = document.createElement('pre')
      const codeElement = document.createElement('code')
      // Set the code content using innerHTML (how the docs page works)
      codeElement.innerHTML = `&lt;div data-component="code-extract-test" data-external&gt;
  &lt;span id="result" data-bind="isActive ? '✅ Yes' : '❌ No'" class="badge"&gt;&lt;/span&gt;
&lt;/div&gt;`
      codeBlock.appendChild(codeElement)

      // Step 1: Extract via textContent (like extractCodeFromTab)
      const htmlCode = codeElement.textContent.trim()

      // Step 2: innerHTML round-trip
      const tempContainer = document.createElement('div')
      tempContainer.innerHTML = htmlCode
      tempContainer.querySelectorAll('[data-component]').forEach(el => el.setAttribute('data-external', ''))
      const roundTrippedHtml = tempContainer.innerHTML

      // Step 3: Set preview content
      testContainer.innerHTML = roundTrippedHtml

      // Step 4: Register component
      wildflower.component('code-extract-test', {
        state: { status: 'active' },
        computed: {
          isActive() { return this.status === 'active' }
        }
      })

      // Step 5: Scan
      wildflower.scan(testContainer)
      await waitForCompleteRender()

      const result = testContainer.querySelector('#result')
      expect(result.textContent).toBe('✅ Yes')
    })
  })

  // --- Multi-component batch mode (reproduces the actual docs page bug) ---

  describe('multi-component batch mode', () => {
    it('expression bindings survive state change when other components trigger batch mode', async () => {
      // The actual bug: when multiple components exist, _updateBindings enters
      // batch mode using _batchChangedComponents. A component that is in
      // _componentsToUpdate but NOT in _batchChangedComponents gets skipped,
      // leaving the Effect system's blank values in place.
      testContainer.innerHTML = `
        <div data-component="batch-sibling-a">
          <span id="sibling-a-value" data-bind="count"></span>
        </div>
        <div data-component="batch-sibling-b">
          <span id="sibling-b-value" data-bind="label"></span>
        </div>
        <div data-component="batch-expr-target">
          <select id="role-select" data-model="userRole">
            <option value="guest">Guest</option>
            <option value="admin">Admin</option>
          </select>
          <span id="role-display" data-bind="userRole"></span>
          <span id="access" data-bind="canViewDashboard ? 'Yes' : 'No'"></span>
          <span id="admin-badge" data-bind="isAdmin ? 'Yes' : 'No'"></span>
        </div>
      `

      wildflower.component('batch-sibling-a', {
        state: { count: 0 }
      })
      wildflower.component('batch-sibling-b', {
        state: { label: 'hello' }
      })
      wildflower.component('batch-expr-target', {
        state: { userRole: 'guest', accountStatus: 'active' },
        computed: {
          isUser() { return ['user', 'admin'].includes(this.userRole) },
          isAdmin() { return ['admin', 'superadmin'].includes(this.userRole) },
          isAccountActive() { return this.accountStatus === 'active' },
          canViewDashboard() { return this.isUser && this.isAccountActive }
        }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('#access').textContent).toBe('No')
      expect(testContainer.querySelector('#admin-badge').textContent).toBe('No')

      // Change state via data-model (triggers batch mode with multiple components)
      const select = testContainer.querySelector('#role-select')
      select.value = 'admin'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForCompleteRender()

      expect(testContainer.querySelector('#role-display').textContent).toBe('admin')
      expect(testContainer.querySelector('#access').textContent).toBe('Yes')
      expect(testContainer.querySelector('#admin-badge').textContent).toBe('Yes')

      // Toggle back
      select.value = 'guest'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForCompleteRender()

      expect(testContainer.querySelector('#access').textContent).toBe('No')
      expect(testContainer.querySelector('#admin-badge').textContent).toBe('No')
    })
  })
})
