import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadFramework, resetFramework, waitForCompleteRender, waitForUpdate } from './helpers/load-framework.js'

describe('Debug Nested Model Binding', () => {
  let testContainer

  beforeEach(async () => {
    await loadFramework()
    testContainer = document.createElement('div')
    testContainer.id = 'test-container'
    document.body.appendChild(testContainer)
  })

  afterEach(async () => {
    await resetFramework()
    if (testContainer && testContainer.parentNode) {
      testContainer.parentNode.removeChild(testContainer)
    }
    testContainer = null
  })

  it('debugs reverse operation - check DOM element identity', async () => {
    testContainer.innerHTML = `
      <div data-component="debug-reverse-test">
        <div data-list="groups">
          <template>
            <div class="group">
              <span class="group-name" data-bind="name"></span>
              <div data-list="tasks">
                <template>
                  <div class="task">
                    <input type="text" class="task-input" data-model="title">
                    <span class="task-display" data-bind="title"></span>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    `

    let componentInstance
    wildflower.component('debug-reverse-test', {
      state: {
        groups: [{
          id: 1,
          name: 'Project Alpha',
          tasks: [
            { id: 1, title: 'First' },
            { id: 2, title: 'Second' },
            { id: 3, title: 'Third' },
            { id: 4, title: 'Fourth' }
          ]
        }]
      },
      init() {
        componentInstance = this
      }
    })

    await waitForCompleteRender()

    // Reverse the nested list
    const group = componentInstance.state.groups[0]
    componentInstance.state.groups = [{
      ...group,
      tasks: [...group.tasks].reverse()
    }]

    await waitForCompleteRender()

    // Get input references BEFORE first modification
    const inputsBefore = testContainer.querySelectorAll('.task-input')
    console.warn('[DEBUG] Inputs before first modification:', inputsBefore.length)
    
    // FIRST MODIFICATION
    inputsBefore[0].value = 'Fourth-modified'
    inputsBefore[0].dispatchEvent(new Event('input', { bubbles: true }))
    await waitForUpdate()
    console.warn('[DEBUG] After first modification:', JSON.stringify(componentInstance.state.groups[0].tasks.map(t => t.title)))

    // Get input references AFTER first modification
    const inputsAfter = testContainer.querySelectorAll('.task-input')
    console.warn('[DEBUG] Inputs after first modification:', inputsAfter.length)
    
    // Check if inputs are the same DOM elements
    console.warn('[DEBUG] Are input[3] same elements?', inputsBefore[3] === inputsAfter[3])
    console.warn('[DEBUG] inputsBefore[3] still in DOM?', document.body.contains(inputsBefore[3]))
    console.warn('[DEBUG] inputsAfter[3] still in DOM?', document.body.contains(inputsAfter[3]))
    console.warn('[DEBUG] inputsBefore[3].value:', inputsBefore[3].value)
    console.warn('[DEBUG] inputsAfter[3].value:', inputsAfter[3].value)

    // SECOND MODIFICATION - use FRESH reference
    inputsAfter[3].value = 'First-modified'
    inputsAfter[3].dispatchEvent(new Event('input', { bubbles: true }))
    await waitForUpdate()
    console.warn('[DEBUG] After second modification:', JSON.stringify(componentInstance.state.groups[0].tasks.map(t => t.title)))
    
    expect(componentInstance.state.groups[0].tasks[3].title).toBe('First-modified')
  })
})
