/**
 * WildflowerJS Pool Entity Computed Properties Test Suite
 *
 * Pool entities can declare computed properties in the pool definition.
 * These computeds are scoped per-entity (this === entity) and usable in
 * all template bindings (data-bind, data-bind-class, data-show, etc.).
 *
 * Design principle: the entity definition describes the shape of each
 * entity in the pool. Computed properties are derived values on the entity.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, isMinifiedBuild, hasFeature } from './helpers/load-framework.js'

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

function getInstance(wildflower, el) {
  const compEl = el.closest ? el.closest('[data-component]') : el.querySelector('[data-component]')
  const target = compEl || el
  return wildflower.componentInstances.get(target.dataset.componentId)
}

describeIfPools('Pool Entity Computed Properties', () => {
  let testContainer
  let wildflower

  beforeAll(async () => {
    await loadFramework()
  })

  beforeEach(() => {
    wildflower = window.wildflower
    resetFramework()

    if (wildflower._contextRegistry) {
      wildflower._contextRegistry.contexts?.clear()
      wildflower._contextRegistry.contextsByType?.clear()
      wildflower._contextRegistry.contextsByComponent?.clear()
      wildflower._contextRegistry.dependencies?.clear()
      wildflower._contextRegistry._contextTypeCache?.clear()
      wildflower._contextRegistry._contextModificationCounter = 0
    }
    if (wildflower._listRelationships) {
      wildflower._listRelationships.clear()
    }

    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    testContainer.style.position = 'absolute'
    testContainer.style.left = '-9999px'
    testContainer.style.opacity = '0'
    document.body.appendChild(testContainer)
  })

  afterEach(() => {
    if (wildflower._poolLoopRunning) {
      wildflower._poolLoopRunning = false
      if (wildflower._poolLoopId) {
        cancelAnimationFrame(wildflower._poolLoopId)
        wildflower._poolLoopId = null
      }
    }
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
  })

  // ==========================================================================
  // 1. Computed properties on entity objects
  // ==========================================================================
  describe('computed as entity properties', () => {

    it('entity computed is accessible as a property on the entity', async () => {
      testContainer.innerHTML = `
        <div data-component="entity-computed-test">
          <div data-pool="items">
            <template><div class="item"></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('entity-computed-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                fullName() { return this.first + ' ' + this.last; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, first: 'Jane', last: 'Doe' })
      const entity = pool.get(1)

      expect(entity.fullName).toBe('Jane Doe')
    })

    it('computed can reference multiple properties', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-prop-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('multi-prop-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                summary() { return this.name + ' has ' + this.hp + '/' + this.maxHp + ' HP'; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'Goblin', hp: 20, maxHp: 30 })
      expect(pool.get(1).summary).toBe('Goblin has 20/30 HP')
    })

    it('multiple computeds work on the same entity', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-computed-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('multi-computed-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                doubled()  { return this.value * 2; },
                squared()  { return this.value * this.value; },
                isEven()   { return this.value % 2 === 0; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, value: 4 })
      const e = pool.get(1)
      expect(e.doubled).toBe(8)
      expect(e.squared).toBe(16)
      expect(e.isEven).toBe(true)
    })

    it('computed re-evaluates when entity state changes', async () => {
      testContainer.innerHTML = `
        <div data-component="reactive-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('reactive-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                doubled() { return this.value * 2; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, value: 5 })
      expect(pool.get(1).doubled).toBe(10)

      pool.get(1).value = 100
      expect(pool.get(1).doubled).toBe(200)
    })

    it('entity without computed block still works', async () => {
      testContainer.innerHTML = `
        <div data-component="no-computed-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('no-computed-test', {
        state: {},
        pools: { items: {} },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'Plain' })
      expect(pool.get(1).name).toBe('Plain')
      expect(pool.size).toBe(1)
    })
  })

  // ==========================================================================
  // 2. Computed used in template bindings
  // ==========================================================================
  describe('computed in bindings', () => {

    it('computed can be read by data-bind', async () => {
      testContainer.innerHTML = `
        <div data-component="bind-test">
          <div data-pool="items">
            <template><div class="item"><span data-bind="displayName"></span></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('bind-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                displayName() { return '[' + this.name + ']'; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'Hero' })
      await waitForRAF()

      const span = testContainer.querySelector('.item span')
      expect(span.textContent).toBe('[Hero]')
    })

    it('computed can be read by data-bind-class', async () => {
      testContainer.innerHTML = `
        <div data-component="class-test">
          <div data-pool="items">
            <template><div class="base" data-bind-class="cssClass"></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('class-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                cssClass() { return 'enemy ' + this.state; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, state: 'spawning' })
      await waitForRAF()

      const el = testContainer.querySelector('[data-pool="items"] > div')
      expect(el.className).toContain('enemy')
      expect(el.className).toContain('spawning')
    })

    it('computed can be read by data-show', async () => {
      testContainer.innerHTML = `
        <div data-component="show-test">
          <div data-pool="items">
            <template><div class="item" data-show="isVisible"></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('show-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                isVisible() { return !this.hidden; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, hidden: false })
      pool.push({ id: 2, hidden: true })
      await waitForRAF()

      const items = testContainer.querySelectorAll('[data-pool="items"] > .item')
      expect(items.length).toBe(2)
      // Visible item: no display:none
      const visibleItem = [...items].find(el => el.style.display !== 'none')
      const hiddenItem = [...items].find(el => el.style.display === 'none')
      expect(visibleItem).toBeDefined()
      expect(hiddenItem).toBeDefined()
    })

    it('binding updates when computed re-evaluates after mutation', async () => {
      testContainer.innerHTML = `
        <div data-component="update-test">
          <div data-pool="items">
            <template><div class="item"><span data-bind="doubled"></span></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('update-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                doubled() { return this.value * 2; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, value: 5 })
      await waitForRAF()

      let span = testContainer.querySelector('.item span')
      expect(span.textContent).toBe('10')

      pool.get(1).value = 50
      pool.markDirty(1)
      await waitForRAF()

      span = testContainer.querySelector('.item span')
      expect(span.textContent).toBe('100')
    })
  })

  // ==========================================================================
  // 3. `this` binding
  // ==========================================================================
  describe('this binding in computed', () => {

    it('computed function has `this` bound to the entity', async () => {
      testContainer.innerHTML = `
        <div data-component="this-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      let capturedThis = null
      wildflower.component('this-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                probe() {
                  capturedThis = this;
                  return this.id;
                }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      const entity = { id: 42, name: 'X' };
      pool.push(entity);
      // Access computed to trigger evaluation
      const result = pool.get(42).probe;

      expect(result).toBe(42);
      expect(capturedThis).toBeDefined();
      expect(capturedThis.id).toBe(42);
      expect(capturedThis.name).toBe('X');
    })

    it('each entity sees its own `this`, not a shared one', async () => {
      testContainer.innerHTML = `
        <div data-component="isolated-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('isolated-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                label() { return 'item-' + this.id; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1 });
      pool.push({ id: 2 });
      pool.push({ id: 3 });

      expect(pool.get(1).label).toBe('item-1');
      expect(pool.get(2).label).toBe('item-2');
      expect(pool.get(3).label).toBe('item-3');
    })
  })

  // ==========================================================================
  // 4. Mixed computed-reading + direct property bindings
  // ==========================================================================
  describe('mixed bindings', () => {

    it('template can mix direct property and computed bindings', async () => {
      testContainer.innerHTML = `
        <div data-component="mixed-test">
          <div data-pool="items">
            <template>
              <div class="item">
                <span class="raw" data-bind="name"></span>
                <span class="computed" data-bind="shouty"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('mixed-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                shouty() { return this.name.toUpperCase() + '!'; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'hello' });
      await waitForRAF();

      const raw = testContainer.querySelector('.item .raw');
      const computed = testContainer.querySelector('.item .computed');
      expect(raw.textContent).toBe('hello');
      expect(computed.textContent).toBe('HELLO!');
    })
  })

  // ==========================================================================
  // 5. Computed depending on other computed
  // ==========================================================================
  describe('computed depending on computed', () => {

    it('one computed can reference another on the same entity', async () => {
      testContainer.innerHTML = `
        <div data-component="chained-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('chained-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                doubled()   { return this.value * 2; },
                quadrupled(){ return this.doubled * 2; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, value: 3 });
      expect(pool.get(1).doubled).toBe(6);
      expect(pool.get(1).quadrupled).toBe(12);
    })
  })

  // ==========================================================================
  // 6. Backward compatibility
  // ==========================================================================
  describe('backward compatibility', () => {

    it('pools without entity block behave exactly as before', async () => {
      testContainer.innerHTML = `
        <div data-component="legacy-test">
          <div data-pool="items">
            <template><div class="item"><span data-bind="name"></span></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('legacy-test', {
        state: {},
        pools: { items: {} },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'Still works' });
      await waitForRAF();

      const span = testContainer.querySelector('.item span');
      expect(span.textContent).toBe('Still works');
    })

    it('computed does not override existing property with same name', async () => {
      // Design decision: entity's own properties take precedence. A computed
      // with the same name as an entity property is effectively shadowed.
      // This prevents developers from breaking existing property access.
      testContainer.innerHTML = `
        <div data-component="shadow-test">
          <div data-pool="items"><template><div></div></template></div>
        </div>
      `

      let pool = null
      wildflower.component('shadow-test', {
        state: {},
        pools: {
          items: {
            entity: {
              computed: {
                name() { return 'computed-name'; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, name: 'literal-name' });
      // Entity's own property wins; computed of same name is unreachable
      expect(pool.get(1).name).toBe('literal-name');
    })
  })

  // ==========================================================================
  // 7. Regression: entity computed + pool props in same pool
  // ==========================================================================
  // When a pool declares `props`, _applyBindings copies the entity into a
  // reusable ctx buffer via Object.assign. Computed getters must be reachable
  // through that buffer — otherwise bindings read undefined.
  describe('entity computed combined with pool props', () => {

    it('template binding reads entity computed when pool also declares props', async () => {
      testContainer.innerHTML = `
        <div data-component="computed-with-props-test">
          <div data-pool="items" data-key="id">
            <template><div class="row" data-bind-class="cssClass"></div></template>
          </div>
        </div>
      `

      let pool = null
      wildflower.component('computed-with-props-test', {
        state: {},
        pools: {
          items: {
            props: { palette: { hot: 'danger', cold: 'info' } },
            entity: {
              computed: {
                cssClass() { return 'row ' + this.kind; }
              }
            }
          }
        },
        init() { pool = this.pool('items'); }
      })
      ensureComponentScanning(wildflower)
      await waitForCompleteRender()

      pool.push({ id: 1, kind: 'alpha' })
      pool.push({ id: 2, kind: 'beta' })
      await waitForRAF()

      const rows = testContainer.querySelectorAll('.row')
      expect(rows[0].classList.contains('alpha')).toBe(true)
      expect(rows[1].classList.contains('beta')).toBe(true)
    })
  })

  // ==========================================================================
  // 8. Arrow function guard (parallel to the one in entity methods)
  // ==========================================================================
  describe('arrow function guard', () => {
    it('throws at pool registration when an entity computed is an arrow function', () => {
      testContainer.innerHTML = `
        <div data-component="arrow-computed-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      expect(() => {
        wildflower.component('arrow-computed-test', {
          state: {},
          pools: {
            items: {
              entity: {
                computed: {
                  cssClass: () => 'nope'
                }
              }
            }
          },
          init() {}
        })
        ensureComponentScanning(wildflower)
      }).toThrow(/entity\.computed "cssClass".*arrow function/)
    })

    it('regular (shorthand) computed definitions do not throw', async () => {
      testContainer.innerHTML = `
        <div data-component="shorthand-computed-test">
          <div data-pool="items" data-key="id"><template><div></div></template></div>
        </div>
      `

      expect(() => {
        wildflower.component('shorthand-computed-test', {
          state: {},
          pools: {
            items: {
              entity: {
                computed: {
                  doubled() { return this.value * 2; }
                }
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
})
