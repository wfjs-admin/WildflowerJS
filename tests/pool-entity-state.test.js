/**
 * WildflowerJS Pool Entity State Template Test Suite
 *
 * Pools can declare an `entity.state` block containing default values
 * merged into every newly-added entity.
 *
 * Design decisions (locked in by tests):
 *   - Shallow merge only (no deep/recursive)
 *   - Spawn-provided fields always win over template defaults
 *   - Template is opt-in; pools without it treat entities as plain objects
 *   - Composes with entity.computed and entity methods
 *
 * Framing: pool entities use the unified entity model — they declare state
 * the same way components, stores, and plugins do.
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

describeIfPools('Pool Entity State Template', () => {
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

  describe('merge-on-add', () => {
    it('template fields are added to entities that omit them', async () => {
      testContainer.innerHTML = `
        <div data-component="state-template-test">
          <div data-pool="enemies" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('state-template-test', {
        state: {},
        pools: {
          enemies: {
            entity: {
              state: { hp: 100, maxHp: 100, eState: 'follow', hpPct: 100 }
            }
          }
        },
        init() { pool = this.pool('enemies'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, x: 10, y: 20 })
      const e = pool.get(1)

      expect(e.id).toBe(1)
      expect(e.x).toBe(10)
      expect(e.y).toBe(20)
      expect(e.hp).toBe(100)
      expect(e.maxHp).toBe(100)
      expect(e.eState).toBe('follow')
      expect(e.hpPct).toBe(100)
    })

    it('spawn-provided fields win over template defaults', async () => {
      testContainer.innerHTML = `
        <div data-component="override-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('override-test', {
        state: {},
        pools: {
          items: {
            entity: {
              state: { hp: 100, level: 1 }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Spawn passes hp explicitly — should win over the default
      pool.push({ id: 1, hp: 250, level: 3 })
      const e = pool.get(1)

      expect(e.hp).toBe(250)
      expect(e.level).toBe(3)
    })

    it('merge is shallow — nested object in template is shared by reference', async () => {
      testContainer.innerHTML = `
        <div data-component="shallow-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('shallow-test', {
        state: {},
        pools: {
          items: {
            entity: {
              state: { stats: { hp: 100, mp: 50 } }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1 })
      pool.push({ id: 2 })

      // Document the contract: shallow merge shares the nested reference.
      // Users who need per-entity nested objects must pass them at spawn.
      expect(pool.get(1).stats).toBe(pool.get(2).stats)
    })

    it('false / 0 / null / undefined spawn values all win over template defaults', async () => {
      testContainer.innerHTML = `
        <div data-component="falsy-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('falsy-test', {
        state: {},
        pools: {
          items: {
            entity: {
              state: { flag: true, count: 10, tag: 'default', note: 'n/a' }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, flag: false, count: 0, tag: null, note: undefined })
      const e = pool.get(1)

      expect(e.flag).toBe(false)
      expect(e.count).toBe(0)
      expect(e.tag).toBeNull()
      expect(e.note).toBeUndefined()
    })
  })

  describe('composition', () => {
    it('state template composes with entity.computed', async () => {
      testContainer.innerHTML = `
        <div data-component="state-plus-computed">
          <div data-pool="items" data-key="id">
            <template><span class="label" data-bind="fullLabel"></span></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('state-plus-computed', {
        state: {},
        pools: {
          items: {
            entity: {
              state: { kind: 'item', flagged: false },
              computed: {
                fullLabel() { return this.kind + ':' + (this.flagged ? 'yes' : 'no'); }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1 }) // Both fields come from template
      await waitForRAF()

      expect(pool.get(1).fullLabel).toBe('item:no')
    })

    it('state template composes with entity.methods', async () => {
      testContainer.innerHTML = `
        <div data-component="state-plus-methods">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('state-plus-methods', {
        state: {},
        pools: {
          items: {
            entity: {
              state: { hp: 100 },
              damage(n) { this.hp -= n; }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1 })
      expect(pool.get(1).hp).toBe(100)

      pool.get(1).damage(30)
      expect(pool.get(1).hp).toBe(70)
    })

    it('all three — state + computed + methods — can coexist in one entity block', async () => {
      testContainer.innerHTML = `
        <div data-component="full-entity">
          <div data-pool="enemies" data-key="id">
            <template>
              <div class="enemy"><span class="badge" data-show="isDead">DEAD</span></div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('full-entity', {
        state: {},
        pools: {
          enemies: {
            entity: {
              state: { hp: 100, maxHp: 100, eState: 'follow' },
              computed: {
                isDead() { return this.hp <= 0; }
              },
              takeDamage(n) { this.hp -= n; if (this.hp <= 0) this.eState = 'dying'; }
            }
          }
        },
        init() { pool = this.pool('enemies'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Spawn with minimum data — state fills in defaults
      pool.push({ id: 1 })
      await waitForRAF()

      const enemy = pool.get(1)
      expect(enemy.hp).toBe(100)
      expect(enemy.maxHp).toBe(100)
      expect(enemy.eState).toBe('follow')
      expect(enemy.isDead).toBe(false)
      expect(testContainer.querySelector('.badge').style.display).toBe('none')

      // Method mutates — computed re-reads — DOM updates
      enemy.takeDamage(100)
      await waitForRAF()
      expect(enemy.isDead).toBe(true)
      expect(enemy.eState).toBe('dying')
      expect(testContainer.querySelector('.badge').style.display).toBe('')
    })
  })

  describe('backward compatibility', () => {
    it('pools without entity.state behave as plain-object pools', async () => {
      testContainer.innerHTML = `
        <div data-component="no-template-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('no-template-test', {
        state: {},
        pools: { items: {} },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, x: 5 })
      const e = pool.get(1)

      // No template → entity has only what was spawned
      expect(e.id).toBe(1)
      expect(e.x).toBe(5)
      expect(Object.keys(e)).toEqual(['id', 'x'])
    })

    it('entity block with only computed/methods still works (no state)', async () => {
      testContainer.innerHTML = `
        <div data-component="no-state-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('no-state-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: { doubled() { return this.n * 2; } },
              bump() { this.n++; }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, n: 5 })
      expect(pool.get(1).doubled).toBe(10)
      pool.get(1).bump()
      expect(pool.get(1).doubled).toBe(12)
    })
  })

  // ==========================================================================
  // Precedence: state vs computed with the same name
  //
  // state defaults apply first (before computed install), so a state
  // field with the same name becomes the entity's own data property, and
  // the computed getter is skipped under the "own property wins" rule.
  // ==========================================================================
  describe('state-vs-computed naming collision', () => {
    it('state default wins over a computed getter of the same name', async () => {
      testContainer.innerHTML = `
        <div data-component="collision-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('collision-test', {
        state: {},
        pools: {
          items: {
            entity: {
              state: { cssClass: 'from-state' },
              computed: {
                cssClass() { return 'from-computed'; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1 })
      // state default becomes an own data property; computed skips install
      // on "own property wins"; reading returns the state value verbatim.
      expect(pool.get(1).cssClass).toBe('from-state')
    })

    it('spawn-provided field also wins over a same-name computed', async () => {
      testContainer.innerHTML = `
        <div data-component="spawn-collision-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('spawn-collision-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                label() { return 'from-computed'; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, label: 'from-spawn' })
      expect(pool.get(1).label).toBe('from-spawn')
    })
  })

  // ==========================================================================
  // Integration: pool props + entity.state + entity.computed composed
  //
  // Exercises all three entity-block features together on a pool that
  // also declares props. Catches any regression in the ctx-buffer /
  // Object.assign path that previously hid computed from bindings.
  // ==========================================================================
  describe('props + state + computed integration', () => {
    it('template bindings see state defaults, computed values, and pool props together', async () => {
      testContainer.innerHTML = `
        <div data-component="triple-test">
          <div data-pool="items" data-key="id">
            <template>
              <div class="row"
                   data-bind-class="cssClass + ' ' + (props.theme || '')">
                <span class="hp" data-bind="hpLabel"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('triple-test', {
        state: {},
        pools: {
          items: {
            props: { theme: 'dark' },
            entity: {
              state: { hp: 10, maxHp: 10, eState: 'alive' },
              computed: {
                cssClass() { return this.eState === 'dying' ? 'row dying' : 'row alive'; },
                hpLabel()  { return this.hp + '/' + this.maxHp; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      // Spawn with minimum info; state fills in the rest.
      pool.push({ id: 1 })
      await waitForRAF()

      const row = testContainer.querySelector('.row')
      const hp = row.querySelector('.hp')

      // state default + computed + props all reached by the class binding.
      expect(row.classList.contains('alive')).toBe(true)
      expect(row.classList.contains('dark')).toBe(true)
      // computed reads state defaults.
      expect(hp.textContent).toBe('10/10')

      // Mutate state; computed reflects on next flush.
      pool.get(1).eState = 'dying'
      await waitForRAF()
      expect(row.classList.contains('dying')).toBe(true)
      expect(row.classList.contains('dark')).toBe(true)

      // Mutate pool props; binding picks up the new value.
      pool.props.theme = 'light'
      await waitForRAF()
      expect(row.classList.contains('light')).toBe(true)
      expect(row.classList.contains('dark')).toBe(false)
    })
  })
})
