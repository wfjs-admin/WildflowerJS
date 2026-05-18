/**
 * WildflowerJS Pool Entity Methods Test Suite
 *
 * Pool entities declare methods as top-level function properties of their
 * entity block — the same shape components and stores use. Methods bind
 * `this` to the individual entity and are auto-routed when data-action
 * names them.
 *
 * Routing order: entity method first, component method fallback.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, hasFeature } from './helpers/load-framework.js'

const describeIfPools = hasFeature('pools') ? describe : describe.skip

async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

async function waitForRAF() {
  await new Promise(resolve => requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve())
  }))
  await new Promise(resolve => setTimeout(resolve, 10))
}

function ensureComponentScanning(wildflower) {
  if (wildflower._setupDynamicComponentDetection) {
    wildflower._setupDynamicComponentDetection()
  }
}

describeIfPools('Pool Entity Methods', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    wildflower = await loadFramework()
  })

  beforeEach(() => {
    resetFramework(wildflower)
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

  describe('method bound to entity', () => {
    it('data-action routes to entity method and `this` is the entity', async () => {
      testContainer.innerHTML = `
        <div data-component="entity-methods-test">
          <div data-pool="items" data-key="id">
            <template><button class="btn" data-action="kill"></button></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('entity-methods-test', {
        state: {},
        pools: {
          items: {
            entity: {
              kill() { this.state = 'dying'; this.hp = 0; }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, state: 'alive', hp: 10 })
      await waitForRAF()

      testContainer.querySelector('.btn').click()

      const e = pool.get(1)
      expect(e.state).toBe('dying')
      expect(e.hp).toBe(0)
    })

    it('each entity sees its own `this` when clicked', async () => {
      testContainer.innerHTML = `
        <div data-component="per-entity-this">
          <div data-pool="items" data-key="id">
            <template><button class="btn" data-action="bump"></button></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('per-entity-this', {
        state: {},
        pools: {
          items: {
            entity: {
              bump() { this.count = (this.count || 0) + 1; }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, count: 0 })
      pool.push({ id: 2, count: 0 })
      await waitForRAF()

      const btns = testContainer.querySelectorAll('.btn')
      btns[0].click()
      btns[0].click()
      btns[1].click()

      expect(pool.get(1).count).toBe(2)
      expect(pool.get(2).count).toBe(1)
    })
  })

  describe('fallback to component method', () => {
    it('method not defined on entity falls back to component method', async () => {
      testContainer.innerHTML = `
        <div data-component="fallback-test">
          <div data-pool="items" data-key="id">
            <template><button class="btn" data-action="componentOnly"></button></template>
          </div>
        </div>
      `

      let pool = null
      let componentCallCount = 0
      let receivedItem = null

      wildflower.component('fallback-test', {
        state: {},
        pools: {
          items: {
            entity: {
              unrelated() { /* noop */ }
            }
          }
        },
        componentOnly(item) {
          componentCallCount++
          receivedItem = item
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 42, label: 'x' })
      await waitForRAF()

      testContainer.querySelector('.btn').click()

      expect(componentCallCount).toBe(1)
      expect(receivedItem).toBeTruthy()
      expect(receivedItem.id).toBe(42)
    })

    it('entity method wins when both component and entity define same name', async () => {
      testContainer.innerHTML = `
        <div data-component="wins-test">
          <div data-pool="items" data-key="id">
            <template><button class="btn" data-action="tag"></button></template>
          </div>
        </div>
      `

      let pool = null
      let componentCalled = false

      wildflower.component('wins-test', {
        state: {},
        pools: {
          items: {
            entity: {
              tag() { this.tagged = true; }
            }
          }
        },
        tag() { componentCalled = true; },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, tagged: false })
      await waitForRAF()

      testContainer.querySelector('.btn').click()

      expect(pool.get(1).tagged).toBe(true)
      expect(componentCalled).toBe(false)
    })
  })

  describe('composition with entity.computed', () => {
    it('entity can declare both computed and methods', async () => {
      testContainer.innerHTML = `
        <div data-component="mix-test">
          <div data-pool="items" data-key="id">
            <template><span class="lbl" data-bind="display"></span></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('mix-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                display() { return this.name + ' (' + this.hp + ')'; }
              },
              heal(amount) { this.hp += amount; }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'goblin', hp: 5 })
      await waitForRAF()

      expect(testContainer.querySelector('.lbl').textContent).toBe('goblin (5)')

      // Call the method directly on the entity
      pool.get(1).heal(3)
      expect(pool.get(1).hp).toBe(8)
    })
  })

  describe('method signature', () => {
    it('entity method receives (event) as single arg — entity is `this`', async () => {
      testContainer.innerHTML = `
        <div data-component="sig-test">
          <div data-pool="items" data-key="id">
            <template><button class="btn" data-action="tap"></button></template>
          </div>
        </div>
      `

      let pool = null
      let capturedArgs = null
      let capturedThis = null

      wildflower.component('sig-test', {
        state: {},
        pools: {
          items: {
            entity: {
              tap(...args) {
                capturedThis = this
                capturedArgs = args
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 99, label: 'x' })
      await waitForRAF()

      testContainer.querySelector('.btn').click()

      expect(capturedThis).toBe(pool.get(99))
      // Signature contract: one positional arg, the DOM event.
      expect(capturedArgs.length).toBe(1)
      expect(capturedArgs[0]).toBeInstanceOf(Event)
    })
  })

  describe('arrow function guard', () => {
    it('throws at pool registration when an entity method is an arrow function', () => {
      testContainer.innerHTML = `
        <div data-component="arrow-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      expect(() => {
        wildflower.component('arrow-test', {
          state: {},
          pools: {
            items: {
              entity: {
                kill: () => { /* this is not the entity */ }
              }
            }
          },
          init() {}
        })
        ensureComponentScanning(wildflower)
      }).toThrow(/entity method "kill".*arrow function/)
    })

    it('regular (shorthand) methods do not throw', async () => {
      testContainer.innerHTML = `
        <div data-component="shorthand-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      expect(() => {
        wildflower.component('shorthand-test', {
          state: {},
          pools: {
            items: {
              entity: {
                kill() { this.hp = 0; }
              }
            }
          },
          init() {}
        })
        ensureComponentScanning(wildflower)
      }).not.toThrow()

      await waitForCompleteRender()
    })
  })

  describe('computed interaction', () => {
    it('entity method mutates state — dependent computed reflects on next read', async () => {
      testContainer.innerHTML = `
        <div data-component="mutation-test">
          <div data-pool="items" data-key="id">
            <template><span class="label" data-bind="label"></span></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('mutation-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                label() { return this.name + ':' + this.hp; }
              },
              damage(n) { this.hp -= n; }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'orc', hp: 10 })
      await waitForRAF()
      expect(testContainer.querySelector('.label').textContent).toBe('orc:10')

      pool.get(1).damage(3)
      // Computed re-reads through the getter on every property access — no cache,
      // so the mutation is reflected on the very next binding read.
      expect(pool.get(1).label).toBe('orc:7')
    })
  })

  describe('end-to-end entity integration (method → computed → binding)', () => {
    // Proves the entity pieces compose: firing a method via data-action
    // mutates state, the dependent computed re-reads without a cache, and
    // the DOM binding reflects the new value on next flush.
    it('method fires via data-action → computed updates → data-show flips', async () => {
      testContainer.innerHTML = `
        <div data-component="entity-integration">
          <div data-pool="enemies" data-key="id">
            <template>
              <div class="enemy">
                <button class="hit-btn" data-action="takeDamage"></button>
                <span class="badge" data-show="isDead">DEAD</span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('entity-integration', {
        state: {},
        pools: {
          enemies: {
            entity: {
              computed: {
                isDead() { return this.hp <= 0; }
              },
              takeDamage() { this.hp -= 50; }
            }
          }
        },
        init() { pool = this.pool('enemies'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, hp: 100 })
      await waitForRAF()

      const enemy = testContainer.querySelector('.enemy')
      const badge = enemy.querySelector('.badge')
      const btn = enemy.querySelector('.hit-btn')

      // Initially alive — DEAD badge hidden
      expect(badge.style.display).toBe('none')

      // First hit: hp 100 → 50, still alive
      btn.click()
      await waitForRAF()
      expect(pool.get(1).hp).toBe(50)
      expect(badge.style.display).toBe('none')

      // Second hit: hp 50 → 0, now dead, badge shows
      btn.click()
      await waitForRAF()
      expect(pool.get(1).hp).toBe(0)
      expect(badge.style.display).toBe('')
    })
  })

  describe('pool.get sanity at scale', () => {
    it('get(key) returns the correct entity on a large pool', async () => {
      testContainer.innerHTML = `
        <div data-component="scale-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('scale-test', {
        state: {},
        pools: { items: {} },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const N = 5000
      const batch = new Array(N)
      for (let i = 0; i < N; i++) batch[i] = { id: i, tag: 'e' + i }
      pool.push(batch)

      // Spot-check several keys; identity must match
      expect(pool.get(0).tag).toBe('e0')
      expect(pool.get(1234).tag).toBe('e1234')
      expect(pool.get(N - 1).tag).toBe('e' + (N - 1))
      expect(pool.get(N + 999)).toBeUndefined()
    })
  })

  describe('backward compatibility', () => {
    it('pools without entity methods keep routing to component methods', async () => {
      testContainer.innerHTML = `
        <div data-component="legacy-routing">
          <div data-pool="items" data-key="id">
            <template><button class="btn" data-action="handle"></button></template>
          </div>
        </div>
      `

      let pool = null
      let handled = null
      wildflower.component('legacy-routing', {
        state: {},
        pools: { items: {} },
        handle(item) { handled = item.id; },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 7 })
      await waitForRAF()

      testContainer.querySelector('.btn').click()
      expect(handled).toBe(7)
    })
  })

  // ==========================================================================
  // Entity method can read entity.computed via `this`
  //
  // Both computed and methods install on the entity with `this === entity`
  // at call time, so a method body can read a computed name through `this`
  // like any other entity property. Locks in the composition contract.
  // ==========================================================================
  describe('method reads computed via this', () => {
    it('entity method can read another entity.computed value through this', async () => {
      testContainer.innerHTML = `
        <div data-component="method-reads-computed">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      let seenByMethod = null

      wildflower.component('method-reads-computed', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                doubled() { return this.n * 2; }
              },
              snapshot() {
                // Reads the entity's own computed through `this`.
                seenByMethod = this.doubled;
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, n: 7 })
      pool.get(1).snapshot()

      expect(seenByMethod).toBe(14)

      // Mutate state; method re-reads the fresh computed value.
      pool.get(1).n = 100
      pool.get(1).snapshot()
      expect(seenByMethod).toBe(200)
    })
  })
})
