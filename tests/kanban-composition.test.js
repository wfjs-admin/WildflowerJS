/**
 * Kanban Composition Test Suite
 *
 * End-to-end kanban board pattern — store with columns containing cards,
 * components rendering each column, drag-and-drop-style moves.
 * This is the exact real-world pattern that exposed the isSpliceInProgress
 * flag-bleeding bug.
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

describe('Kanban Composition', () => {
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

  /**
   * Helper: create a kanban store + component pair and render them.
   * Returns { store, getCards(colIndex) } for assertions.
   */
  function setupKanban(storeName, compName, columns) {
    wildflower.store(storeName, {
      state: { columns }
    })

    testContainer.innerHTML = `
      <div data-component="${compName}">
        <div data-list="boardColumns">
          <template>
            <div class="column">
              <h3 class="col-title" data-bind="title"></h3>
              <div class="card-list" data-list="cards">
                <template>
                  <div class="card">
                    <span class="card-title" data-bind="title"></span>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    wildflower.component(compName, {
      state: {},
      subscribe: { [storeName]: ['columns'] },
      computed: {
        boardColumns() {
          return this.stores[storeName].columns || []
        }
      }
    })

    return {
      store: wildflower.getStore(storeName),
      getColumns: () => testContainer.querySelectorAll('.column'),
      getCards: (colIdx) => {
        const cols = testContainer.querySelectorAll('.column')
        return cols[colIdx] ? cols[colIdx].querySelectorAll('.card') : []
      },
      getColTitle: (colIdx) => {
        const cols = testContainer.querySelectorAll('.column')
        return cols[colIdx]?.querySelector('.col-title')?.textContent || ''
      }
    }
  }

  it('renders 3 columns each with 2-3 cards on initial load', async () => {
    const sn = unique('kb-init')
    const cn = unique('kb-board')
    const { getColumns, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Todo', cards: [{ id: 1, title: 'Card A' }, { id: 2, title: 'Card B' }] },
      { id: 2, title: 'In Progress', cards: [{ id: 3, title: 'Card C' }, { id: 4, title: 'Card D' }, { id: 5, title: 'Card E' }] },
      { id: 3, title: 'Done', cards: [{ id: 6, title: 'Card F' }, { id: 7, title: 'Card G' }] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    expect(getColumns().length).toBe(3)
    expect(getCards(0).length).toBe(2)
    expect(getCards(1).length).toBe(3)
    expect(getCards(2).length).toBe(2)
  })

  it('moves card from column A to column B', async () => {
    const sn = unique('kb-move')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Todo', cards: [{ id: 1, title: 'Move Me' }, { id: 2, title: 'Stay' }] },
      { id: 2, title: 'Done', cards: [{ id: 3, title: 'Already Done' }] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(2)
    expect(getCards(1).length).toBe(1)

    // Move "Move Me" from Todo to Done
    const card = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(store.state.columns[1].cards.length, 0, card)
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(1)
    expect(getCards(0)[0].querySelector('.card-title').textContent).toBe('Stay')
    expect(getCards(1).length).toBe(2)
    expect(getCards(1)[1].querySelector('.card-title').textContent).toBe('Move Me')
  })

  it('moves card to empty column', async () => {
    const sn = unique('kb-empty-target')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Source', cards: [{ id: 1, title: 'Card1' }, { id: 2, title: 'Card2' }] },
      { id: 2, title: 'Empty', cards: [] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(2)
    expect(getCards(1).length).toBe(0)

    const card = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(0, 0, card)
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(1)
    expect(getCards(1).length).toBe(1)
    expect(getCards(1)[0].querySelector('.card-title').textContent).toBe('Card1')
  })

  it('moves all cards out of a column', async () => {
    const sn = unique('kb-empty-source')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Source', cards: [{ id: 1, title: 'Only Card' }] },
      { id: 2, title: 'Target', cards: [{ id: 2, title: 'Existing' }] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    const card = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(store.state.columns[1].cards.length, 0, card)
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(0)
    expect(getCards(1).length).toBe(2)
  })

  it('reorders card within same column via splice remove + splice insert', async () => {
    const sn = unique('kb-reorder')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Col', cards: [
        { id: 1, title: 'First' },
        { id: 2, title: 'Second' },
        { id: 3, title: 'Third' }
      ] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    // Move "Third" to the top
    const card = store.state.columns[0].cards.splice(2, 1)[0]
    store.state.columns[0].cards.splice(0, 0, card)
    await waitForCompleteRender()

    const cards = getCards(0)
    expect(cards.length).toBe(3)
    expect(cards[0].querySelector('.card-title').textContent).toBe('Third')
    expect(cards[1].querySelector('.card-title').textContent).toBe('First')
    expect(cards[2].querySelector('.card-title').textContent).toBe('Second')
  })

  it('adds new card to a column via push', async () => {
    const sn = unique('kb-add')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Col', cards: [{ id: 1, title: 'Existing' }] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(1)

    store.state.columns[0].cards.push({ id: 2, title: 'New Card' })
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(2)
    expect(getCards(0)[1].querySelector('.card-title').textContent).toBe('New Card')
  })

  it('deletes card from a column via splice', async () => {
    const sn = unique('kb-delete')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Col', cards: [
        { id: 1, title: 'Keep' },
        { id: 2, title: 'Delete Me' },
        { id: 3, title: 'Also Keep' }
      ] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(3)

    store.state.columns[0].cards.splice(1, 1)
    await waitForCompleteRender()

    const cards = getCards(0)
    expect(cards.length).toBe(2)
    expect(cards[0].querySelector('.card-title').textContent).toBe('Keep')
    expect(cards[1].querySelector('.card-title').textContent).toBe('Also Keep')
  })

  it('updates card property after move', async () => {
    const sn = unique('kb-update-after-move')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'Todo', cards: [{ id: 1, title: 'Original Title' }] },
      { id: 2, title: 'Done', cards: [] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    // Move card
    const card = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(0, 0, card)
    await waitForCompleteRender()

    // Update the moved card's title
    store.state.columns[1].cards[0].title = 'Updated Title'
    await waitForCompleteRender()

    expect(getCards(1)[0].querySelector('.card-title').textContent).toBe('Updated Title')
  })

  it('handles rapid sequential moves (3 moves in succession)', async () => {
    const sn = unique('kb-rapid')
    const cn = unique('kb-board')
    const { store, getCards } = setupKanban(sn, cn, [
      { id: 1, title: 'A', cards: [{ id: 1, title: 'C1' }, { id: 2, title: 'C2' }, { id: 3, title: 'C3' }] },
      { id: 2, title: 'B', cards: [] },
      { id: 3, title: 'C', cards: [] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    // Move 1: A→B
    const c1 = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(0, 0, c1)
    await waitForCompleteRender()

    // Move 2: A→C
    const c2 = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[2].cards.splice(0, 0, c2)
    await waitForCompleteRender()

    // Move 3: B→C
    const c3 = store.state.columns[1].cards.splice(0, 1)[0]
    store.state.columns[2].cards.splice(store.state.columns[2].cards.length, 0, c3)
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(1) // C3 remains
    expect(getCards(1).length).toBe(0)
    expect(getCards(2).length).toBe(2) // C2 and C1
  })

  it('moves card then updates column title', async () => {
    const sn = unique('kb-move-title')
    const cn = unique('kb-board')
    const { store, getCards, getColTitle } = setupKanban(sn, cn, [
      { id: 1, title: 'Source', cards: [{ id: 1, title: 'Card' }] },
      { id: 2, title: 'Target', cards: [] }
    ])

    wildflower.scan()
    await waitForCompleteRender()

    // Move card + update title in same batch
    const card = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(0, 0, card)
    store.state.columns[1].title = 'Target (1)'
    await waitForCompleteRender()

    expect(getCards(0).length).toBe(0)
    expect(getCards(1).length).toBe(1)
    expect(getColTitle(1)).toBe('Target (1)')
  })

  it('computed card count updates after move', async () => {
    const sn = unique('kb-count')
    const cn = unique('kb-count-board')

    wildflower.store(sn, {
      state: {
        columns: [
          { id: 1, title: 'Todo', cards: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] },
          { id: 2, title: 'Done', cards: [] }
        ]
      }
    })

    testContainer.innerHTML = `
      <div data-component="${cn}">
        <span id="todo-count" data-bind="computed:todoCount"></span>
        <span id="done-count" data-bind="computed:doneCount"></span>
      </div>
    `

    wildflower.component(cn, {
      state: {},
      subscribe: { [sn]: ['columns'] },
      computed: {
        todoCount() {
          const cols = this.stores[sn].columns
          return cols ? cols[0].cards.length : 0
        },
        doneCount() {
          const cols = this.stores[sn].columns
          return cols ? cols[1].cards.length : 0
        }
      }
    })

    wildflower.scan()
    await waitForCompleteRender()

    expect(testContainer.querySelector('#todo-count').textContent).toBe('2')
    expect(testContainer.querySelector('#done-count').textContent).toBe('0')

    // Move card
    const store = wildflower.getStore(sn)
    const card = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(0, 0, card)
    await waitForCompleteRender()

    expect(testContainer.querySelector('#todo-count').textContent).toBe('1')
    expect(testContainer.querySelector('#done-count').textContent).toBe('1')
  })

  it('full board with store methods: moveCard, addCard, removeCard', async () => {
    const sn = unique('kb-methods')
    const cn = unique('kb-methods-board')

    wildflower.store(sn, {
      state: {
        columns: [
          { id: 1, title: 'Backlog', cards: [{ id: 1, title: 'Feature X' }] },
          { id: 2, title: 'Sprint', cards: [{ id: 2, title: 'Bug Fix' }] },
          { id: 3, title: 'Done', cards: [] }
        ]
      }
    })

    const store = wildflower.getStore(sn)

    // Simulate store methods via direct mutations
    // moveCard: from col 0 to col 1
    const moved = store.state.columns[0].cards.splice(0, 1)[0]
    store.state.columns[1].cards.splice(store.state.columns[1].cards.length, 0, moved)
    await waitForUpdate()

    expect(store.state.columns[0].cards.length).toBe(0)
    expect(store.state.columns[1].cards.length).toBe(2)

    // addCard to col 0
    store.state.columns[0].cards.push({ id: 3, title: 'New Feature' })
    await waitForUpdate()

    expect(store.state.columns[0].cards.length).toBe(1)
    expect(store.state.columns[0].cards[0].title).toBe('New Feature')

    // removeCard from col 1
    store.state.columns[1].cards.splice(0, 1)
    await waitForUpdate()

    expect(store.state.columns[1].cards.length).toBe(1)
    expect(store.state.columns[1].cards[0].title).toBe('Feature X')

    // moveCard: from col 1 to col 2
    const done = store.state.columns[1].cards.splice(0, 1)[0]
    store.state.columns[2].cards.splice(0, 0, done)
    await waitForUpdate()

    expect(store.state.columns[1].cards.length).toBe(0)
    expect(store.state.columns[2].cards.length).toBe(1)
    expect(store.state.columns[2].cards[0].title).toBe('Feature X')
  })
})
