/**
 * WildflowerJS Nested Lists Test Suite - Vitest Browser Mode
 *
 * Comprehensive tests for nested data-list functionality.
 * Tests 2-level and 3-level nested lists with add/remove operations.
 *
 * These tests specifically cover regressions fixed in commit cf15b77:
 * - Bulk replacement guard skipping nested list processing
 * - Sparse update contaminating nested list bindings
 * - :scope > selector for correct element lookup across nested lists
 * - Fingerprint tracking during removal operations
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { loadFramework, resetFramework, getDistMode, getListItems } from './helpers/load-framework.js'

// Helper to wait for framework processing
async function waitForUpdate(ms = 50) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// Helper to wait for complete render cycle (for lists)
async function waitForCompleteRender() {
  if (window.wildflower?._forceCompleteRender) {
    await window.wildflower._forceCompleteRender()
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}

describe('Nested List System', () => {
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

  // ============================================================
  // 2-LEVEL NESTED LISTS (Projects -> Tasks)
  // ============================================================

  describe('2-Level Nested Lists (Projects -> Tasks)', () => {

    it('renders nested lists correctly on initial load', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-2level">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-2level', {
        state: {
          projects: [
            { id: 1, name: 'Project A', tasks: [
              { id: 101, title: 'Task 1' },
              { id: 102, title: 'Task 2' }
            ]},
            { id: 2, name: 'Project B', tasks: [
              { id: 201, title: 'Task A' }
            ]}
          ]
        }
      })

      await waitForCompleteRender()

      // Verify projects
      const projects = testContainer.querySelectorAll('[data-list="projects"] > :not(template)')
      expect(projects.length).toBe(2)
      expect(projects[0].querySelector('.project-name').textContent).toBe('Project A')
      expect(projects[1].querySelector('.project-name').textContent).toBe('Project B')

      // Verify tasks in first project
      const project1Tasks = projects[0].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(project1Tasks.length).toBe(2)
      expect(project1Tasks[0].querySelector('.task-title').textContent).toBe('Task 1')
      expect(project1Tasks[1].querySelector('.task-title').textContent).toBe('Task 2')

      // Verify tasks in second project
      const project2Tasks = projects[1].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(project2Tasks.length).toBe(1)
      expect(project2Tasks[0].querySelector('.task-title').textContent).toBe('Task A')
    })

    it('adds task to nested list without affecting other content', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-add-task">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-add-task', {
        state: {
          projects: [
            { id: 1, name: 'Project A', tasks: [
              { id: 101, title: 'Task 1' },
              { id: 102, title: 'Task 2' }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      let tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(2)
      expect(tasks[0].querySelector('.task-title').textContent).toBe('Task 1')
      expect(tasks[1].querySelector('.task-title').textContent).toBe('Task 2')

      // Add a new task
      const project = componentInstance.state.projects[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: [...project.tasks, { id: 103, title: 'Task 3' }]
      }]

      await waitForCompleteRender()

      // Verify task was added AND existing tasks preserved their text
      tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(3)
      expect(tasks[0].querySelector('.task-title').textContent).toBe('Task 1')
      expect(tasks[1].querySelector('.task-title').textContent).toBe('Task 2')
      expect(tasks[2].querySelector('.task-title').textContent).toBe('Task 3')
    })

    it('removes task from middle without clearing text of other tasks', async () => {
      // This test specifically covers the "Task 1 loses text" bug
      testContainer.innerHTML = `
        <div data-component="nested-remove-task">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-remove-task', {
        state: {
          projects: [
            { id: 1, name: 'Project A', tasks: [
              { id: 101, title: 'Task 1' },
              { id: 102, title: 'Task 2' },
              { id: 103, title: 'Task 3' }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      let tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(3)

      // Remove Task 2 (middle task)
      const project = componentInstance.state.projects[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: project.tasks.filter(t => t.id !== 102)
      }]

      await waitForCompleteRender()

      // CRITICAL: Verify Task 1 still has its text (this was the bug)
      tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(2)
      expect(tasks[0].querySelector('.task-title').textContent).toBe('Task 1')
      expect(tasks[1].querySelector('.task-title').textContent).toBe('Task 3')
    })

    it('handles multiple projects with nested tasks correctly', async () => {
      // This test covers the :scope > selector fix for Project 2
      testContainer.innerHTML = `
        <div data-component="multi-project">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('multi-project', {
        state: {
          projects: [
            { id: 1, name: 'Project 1', tasks: [{ id: 101, title: 'P1-Task1' }] },
            { id: 2, name: 'Project 2', tasks: [{ id: 201, title: 'P2-Task1' }] },
            { id: 3, name: 'Project 3', tasks: [{ id: 301, title: 'P3-Task1' }] },
            { id: 4, name: 'Project 4', tasks: [{ id: 401, title: 'P4-Task1' }] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Add task to Project 2 (this was failing when 4+ projects existed)
      const projects = [...componentInstance.state.projects]
      projects[1] = {
        ...projects[1],
        tasks: [...projects[1].tasks, { id: 202, title: 'P2-Task2' }]
      }
      componentInstance.state.projects = projects

      await waitForCompleteRender()

      // Verify Project 2 has 2 tasks
      const projectElements = getListItems(testContainer.querySelector('[data-list="projects"]'))
      const project2Tasks = getListItems(projectElements[1].querySelector('[data-list="tasks"]'))
      expect(project2Tasks.length).toBe(2)
      expect(project2Tasks[0].querySelector('.task-title').textContent).toBe('P2-Task1')
      expect(project2Tasks[1].querySelector('.task-title').textContent).toBe('P2-Task2')

      // Verify other projects unchanged
      const project1Tasks = getListItems(projectElements[0].querySelector('[data-list="tasks"]'))
      expect(project1Tasks.length).toBe(1)
      expect(project1Tasks[0].querySelector('.task-title').textContent).toBe('P1-Task1')
    })

    it('removes project without affecting sibling projects', async () => {
      testContainer.innerHTML = `
        <div data-component="remove-project">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('remove-project', {
        state: {
          projects: [
            { id: 1, name: 'Project A', tasks: [{ id: 101, title: 'Task A1' }] },
            { id: 2, name: 'Project B', tasks: [{ id: 201, title: 'Task B1' }] },
            { id: 3, name: 'Project C', tasks: [{ id: 301, title: 'Task C1' }] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Remove Project B (middle)
      componentInstance.state.projects = componentInstance.state.projects.filter(p => p.id !== 2)

      await waitForCompleteRender()

      // Verify projects A and C still have correct content
      const projects = testContainer.querySelectorAll('[data-list="projects"] > :not(template)')
      expect(projects.length).toBe(2)
      expect(projects[0].querySelector('.project-name').textContent).toBe('Project A')
      expect(projects[1].querySelector('.project-name').textContent).toBe('Project C')

      // Verify nested tasks still have content
      const taskA = projects[0].querySelector('[data-list="tasks"] > :not(template) .task-title')
      const taskC = projects[1].querySelector('[data-list="tasks"] > :not(template) .task-title')
      expect(taskA.textContent).toBe('Task A1')
      expect(taskC.textContent).toBe('Task C1')
    })
  })

  // ============================================================
  // 3-LEVEL NESTED LISTS (Projects -> Tasks -> Subtasks)
  // ============================================================

  describe('3-Level Nested Lists (Projects -> Tasks -> Subtasks)', () => {

    it('renders 3-level nested lists correctly on initial load', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-3level">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                      <div data-list="subtasks">
                        <template>
                          <div class="subtask">
                            <span class="subtask-name" data-bind="name"></span>
                          </div>
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

      wildflower.component('nested-3level', {
        state: {
          projects: [
            {
              id: 1,
              name: 'Project Alpha',
              tasks: [
                {
                  id: 101,
                  title: 'Task 1',
                  subtasks: [
                    { id: 1001, name: 'Subtask 1.1' },
                    { id: 1002, name: 'Subtask 1.2' }
                  ]
                }
              ]
            }
          ]
        }
      })

      await waitForCompleteRender()

      // Verify all 3 levels
      const project = testContainer.querySelector('[data-list="projects"] > :not(template)')
      expect(project.querySelector('.project-name').textContent).toBe('Project Alpha')

      const task = project.querySelector('[data-list="tasks"] > :not(template)')
      expect(task.querySelector('.task-title').textContent).toBe('Task 1')

      const subtasks = task.querySelectorAll('[data-list="subtasks"] > :not(template)')
      expect(subtasks.length).toBe(2)
      expect(subtasks[0].querySelector('.subtask-name').textContent).toBe('Subtask 1.1')
      expect(subtasks[1].querySelector('.subtask-name').textContent).toBe('Subtask 1.2')
    })

    it('adds subtask without affecting parent task or sibling subtasks', async () => {
      testContainer.innerHTML = `
        <div data-component="add-subtask">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                      <div data-list="subtasks">
                        <template>
                          <div class="subtask">
                            <span class="subtask-name" data-bind="name"></span>
                          </div>
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

      let componentInstance
      wildflower.component('add-subtask', {
        state: {
          projects: [
            {
              id: 1,
              name: 'Project Alpha',
              tasks: [
                {
                  id: 101,
                  title: 'Task 1',
                  subtasks: [
                    { id: 1001, name: 'Subtask 1.1' }
                  ]
                }
              ]
            }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Add a subtask
      const project = componentInstance.state.projects[0]
      const task = project.tasks[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: [{
          ...task,
          subtasks: [...task.subtasks, { id: 1002, name: 'Subtask 1.2' }]
        }]
      }]

      await waitForCompleteRender()

      // Verify subtasks
      const subtasks = testContainer.querySelectorAll('[data-list="subtasks"] > :not(template)')
      expect(subtasks.length).toBe(2)
      expect(subtasks[0].querySelector('.subtask-name').textContent).toBe('Subtask 1.1')
      expect(subtasks[1].querySelector('.subtask-name').textContent).toBe('Subtask 1.2')

      // Verify parent content unchanged
      expect(testContainer.querySelector('.project-name').textContent).toBe('Project Alpha')
      expect(testContainer.querySelector('.task-title').textContent).toBe('Task 1')
    })

    it('removes subtask from middle without clearing sibling subtask text', async () => {
      testContainer.innerHTML = `
        <div data-component="remove-subtask">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                      <div data-list="subtasks">
                        <template>
                          <div class="subtask">
                            <span class="subtask-name" data-bind="name"></span>
                          </div>
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

      let componentInstance
      wildflower.component('remove-subtask', {
        state: {
          projects: [
            {
              id: 1,
              name: 'Project Alpha',
              tasks: [
                {
                  id: 101,
                  title: 'Task 1',
                  subtasks: [
                    { id: 1001, name: 'Subtask 1.1' },
                    { id: 1002, name: 'Subtask 1.2' },
                    { id: 1003, name: 'Subtask 1.3' }
                  ]
                }
              ]
            }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Remove Subtask 1.2 (middle)
      const project = componentInstance.state.projects[0]
      const task = project.tasks[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: [{
          ...task,
          subtasks: task.subtasks.filter(s => s.id !== 1002)
        }]
      }]

      await waitForCompleteRender()

      // CRITICAL: Verify remaining subtasks have their text
      const subtasks = testContainer.querySelectorAll('[data-list="subtasks"] > :not(template)')
      expect(subtasks.length).toBe(2)
      expect(subtasks[0].querySelector('.subtask-name').textContent).toBe('Subtask 1.1')
      expect(subtasks[1].querySelector('.subtask-name').textContent).toBe('Subtask 1.3')
    })

    it('handles operations at all three levels simultaneously', async () => {
      testContainer.innerHTML = `
        <div data-component="multi-level-ops">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                      <div data-list="subtasks">
                        <template>
                          <div class="subtask">
                            <span class="subtask-name" data-bind="name"></span>
                          </div>
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

      let componentInstance
      wildflower.component('multi-level-ops', {
        state: {
          projects: [
            {
              id: 1,
              name: 'Project 1',
              tasks: [
                { id: 101, title: 'Task 1', subtasks: [{ id: 1001, name: 'Sub 1' }] }
              ]
            },
            {
              id: 2,
              name: 'Project 2',
              tasks: [
                { id: 201, title: 'Task A', subtasks: [{ id: 2001, name: 'Sub A' }] }
              ]
            }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Perform multiple operations:
      // 1. Add subtask to Project 1, Task 1
      // 2. Add task to Project 2
      const projects = [...componentInstance.state.projects]

      // Add subtask to first project's first task
      projects[0] = {
        ...projects[0],
        tasks: [{
          ...projects[0].tasks[0],
          subtasks: [...projects[0].tasks[0].subtasks, { id: 1002, name: 'Sub 2' }]
        }]
      }

      // Add task to second project
      projects[1] = {
        ...projects[1],
        tasks: [...projects[1].tasks, { id: 202, title: 'Task B', subtasks: [] }]
      }

      componentInstance.state.projects = projects

      await waitForCompleteRender()

      // Verify Project 1 has 2 subtasks
      const projectElements = testContainer.querySelectorAll('[data-list="projects"] > :not(template)')
      const p1Subtasks = projectElements[0].querySelectorAll('[data-list="subtasks"] > :not(template)')
      expect(p1Subtasks.length).toBe(2)
      expect(p1Subtasks[0].querySelector('.subtask-name').textContent).toBe('Sub 1')
      expect(p1Subtasks[1].querySelector('.subtask-name').textContent).toBe('Sub 2')

      // Verify Project 2 has 2 tasks
      const p2Tasks = projectElements[1].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(p2Tasks.length).toBe(2)
      expect(p2Tasks[0].querySelector('.task-title').textContent).toBe('Task A')
      expect(p2Tasks[1].querySelector('.task-title').textContent).toBe('Task B')
    })
  })

  // ============================================================
  // ACTION HANDLERS IN NESTED LISTS
  // ============================================================

  describe('Actions in Nested Lists', () => {

    it('action in nested list correctly identifies parent indices', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-actions">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                      <button class="remove-btn" data-action="removeTask">Remove</button>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let removedInfo = null
      wildflower.component('nested-actions', {
        state: {
          projects: [
            { id: 1, name: 'Project A', tasks: [
              { id: 101, title: 'Task 1' },
              { id: 102, title: 'Task 2' }
            ]},
            { id: 2, name: 'Project B', tasks: [
              { id: 201, title: 'Task A' }
            ]}
          ]
        },
        removeTask(event, element, { index: taskIndex, parent }) {
          const projectIndex = parent?.index ?? null

          removedInfo = { projectIndex, taskIndex }

          if (projectIndex !== null && taskIndex !== null) {
            const projects = [...this.state.projects]
            projects[projectIndex] = {
              ...projects[projectIndex],
              tasks: projects[projectIndex].tasks.filter((_, i) => i !== taskIndex)
            }
            this.state.projects = projects
          }
        }
      })

      await waitForCompleteRender()

      // Click remove button on Task 2 in Project A
      const projects = getListItems(testContainer.querySelector('[data-list="projects"]'))
      const removeBtn = getListItems(projects[0].querySelector('[data-list="tasks"]'))[1]
        .querySelector('.remove-btn')

      removeBtn.click()
      await waitForCompleteRender()

      // Verify correct indices were captured
      expect(removedInfo).toEqual({ projectIndex: 0, taskIndex: 1 })

      // Verify task was removed
      const tasks = getListItems(projects[0].querySelector('[data-list="tasks"]'))
      expect(tasks.length).toBe(1)
      expect(tasks[0].querySelector('.task-title').textContent).toBe('Task 1')
    })

    it('multiple sequential add operations work correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="sequential-adds">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('sequential-adds', {
        state: {
          projects: [
            { id: 1, name: 'Project A', tasks: [{ id: 101, title: 'Task 1' }] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Add 3 tasks sequentially
      for (let i = 2; i <= 4; i++) {
        const project = componentInstance.state.projects[0]
        componentInstance.state.projects = [{
          ...project,
          tasks: [...project.tasks, { id: 100 + i, title: `Task ${i}` }]
        }]
        await waitForCompleteRender()
      }

      // Verify all 4 tasks exist with correct text
      const tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(4)
      expect(tasks[0].querySelector('.task-title').textContent).toBe('Task 1')
      expect(tasks[1].querySelector('.task-title').textContent).toBe('Task 2')
      expect(tasks[2].querySelector('.task-title').textContent).toBe('Task 3')
      expect(tasks[3].querySelector('.task-title').textContent).toBe('Task 4')
    })

    it('multiple sequential remove operations work correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="sequential-removes">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('sequential-removes', {
        state: {
          projects: [
            { id: 1, name: 'Project A', tasks: [
              { id: 101, title: 'Task 1' },
              { id: 102, title: 'Task 2' },
              { id: 103, title: 'Task 3' },
              { id: 104, title: 'Task 4' }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Remove tasks 2 and 3 sequentially (from middle)
      const project = componentInstance.state.projects[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: project.tasks.filter(t => t.id !== 102)
      }]
      await waitForCompleteRender()

      // Now remove what was task 3 (now at index 1)
      const updatedProject = componentInstance.state.projects[0]
      componentInstance.state.projects = [{
        ...updatedProject,
        tasks: updatedProject.tasks.filter(t => t.id !== 103)
      }]
      await waitForCompleteRender()

      // Verify remaining tasks have correct text
      const tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(2)
      expect(tasks[0].querySelector('.task-title').textContent).toBe('Task 1')
      expect(tasks[1].querySelector('.task-title').textContent).toBe('Task 4')
    })
  })

  // ============================================================
  // CLASS BINDINGS IN NESTED LISTS
  // ============================================================

  describe('Class Bindings in Nested Lists', () => {

    it('applies data-bind-class correctly on nested list items', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-class-binding">
          <div data-list="projects">
            <template>
              <div class="project" data-bind-class="status">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task" data-bind-class="priority">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-class-binding', {
        state: {
          projects: [
            { id: 1, name: 'Project A', status: 'active', tasks: [
              { id: 101, title: 'Task 1', priority: 'high' },
              { id: 102, title: 'Task 2', priority: 'low' }
            ]},
            { id: 2, name: 'Project B', status: 'archived', tasks: [
              { id: 201, title: 'Task A', priority: 'medium' }
            ]}
          ]
        }
      })

      await waitForCompleteRender()

      // Verify project classes
      const projects = testContainer.querySelectorAll('[data-list="projects"] > :not(template)')
      expect(projects[0].classList.contains('active')).toBe(true)
      expect(projects[1].classList.contains('archived')).toBe(true)

      // Verify task classes in first project
      const p1Tasks = projects[0].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(p1Tasks[0].classList.contains('high')).toBe(true)
      expect(p1Tasks[1].classList.contains('low')).toBe(true)

      // Verify task classes in second project
      const p2Tasks = projects[1].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(p2Tasks[0].classList.contains('medium')).toBe(true)
    })

    it('updates class bindings in nested lists when data changes', async () => {
      testContainer.innerHTML = `
        <div data-component="update-nested-class">
          <div data-list="items">
            <template>
              <div class="item" data-bind-class="status">
                <span data-bind="name"></span>
                <div data-list="children">
                  <template>
                    <div class="child" data-bind-class="state">
                      <span data-bind="label"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('update-nested-class', {
        state: {
          items: [
            { id: 1, name: 'Item 1', status: 'pending', children: [
              { id: 101, label: 'Child 1', state: 'inactive' }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial class
      let child = testContainer.querySelector('[data-list="children"] > :not(template)')
      expect(child.classList.contains('inactive')).toBe(true)

      // Update the child's state
      componentInstance.state.items = [{
        ...componentInstance.state.items[0],
        children: [{ id: 101, label: 'Child 1', state: 'active' }]
      }]

      await waitForCompleteRender()

      // Verify class changed
      child = testContainer.querySelector('[data-list="children"] > :not(template)')
      expect(child.classList.contains('active')).toBe(true)
      expect(child.classList.contains('inactive')).toBe(false)
    })

    it('handles boolean class toggling in nested lists', async () => {
      testContainer.innerHTML = `
        <div data-component="bool-class-nested">
          <div data-list="todos">
            <template>
              <div class="todo-item" data-bind-class="done ? 'completed' : ''">
                <span data-bind="text"></span>
                <div data-list="subtasks">
                  <template>
                    <div class="subtask" data-bind-class="finished ? 'completed' : ''">
                      <span data-bind="description"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('bool-class-nested', {
        state: {
          todos: [
            { id: 1, text: 'Todo 1', done: false, subtasks: [
              { id: 101, description: 'Subtask 1', finished: true },
              { id: 102, description: 'Subtask 2', finished: false }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      const subtasks = testContainer.querySelectorAll('[data-list="subtasks"] > :not(template)')
      expect(subtasks[0].classList.contains('completed')).toBe(true)
      expect(subtasks[1].classList.contains('completed')).toBe(false)

      // Toggle the subtask
      const todo = componentInstance.state.todos[0]
      componentInstance.state.todos = [{
        ...todo,
        subtasks: [
          { id: 101, description: 'Subtask 1', finished: true },
          { id: 102, description: 'Subtask 2', finished: true }
        ]
      }]

      await waitForCompleteRender()

      const updatedSubtasks = testContainer.querySelectorAll('[data-list="subtasks"] > :not(template)')
      expect(updatedSubtasks[1].classList.contains('completed')).toBe(true)
    })

    it('preserves existing classes when binding class in nested items', async () => {
      testContainer.innerHTML = `
        <div data-component="preserve-class-nested">
          <div data-list="categories">
            <template>
              <div class="category base-style">
                <div data-list="items">
                  <template>
                    <div class="item styled-item" data-bind-class="type">
                      <span data-bind="name"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('preserve-class-nested', {
        state: {
          categories: [
            { id: 1, items: [
              { id: 101, name: 'Item A', type: 'special' }
            ]}
          ]
        }
      })

      await waitForCompleteRender()

      const item = testContainer.querySelector('[data-list="items"] > :not(template)')
      expect(item.classList.contains('item')).toBe(true)
      expect(item.classList.contains('styled-item')).toBe(true)
      expect(item.classList.contains('special')).toBe(true)
    })
  })

  // ============================================================
  // MODEL/INPUT BINDINGS IN NESTED LISTS
  // ============================================================

  describe('Model Bindings in Nested Lists', () => {

    it('binds input values in nested list items', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-model">
          <div data-list="forms">
            <template>
              <div class="form-section">
                <div data-list="fields">
                  <template>
                    <div class="field">
                      <input type="text" data-model="value">
                      <span class="display" data-bind="value"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-model', {
        state: {
          forms: [
            { id: 1, fields: [
              { id: 101, value: 'initial value' }
            ]}
          ]
        }
      })

      await waitForCompleteRender()

      console.log('=== DOM for input binding test ===')
      console.log(testContainer.innerHTML)

      const input = testContainer.querySelector('[data-list="fields"] > :not(template) input')
      const display = testContainer.querySelector('[data-list="fields"] > :not(template) .display')

      console.log('input found:', !!input, 'value:', input?.value)
      console.log('display found:', !!display, 'text:', display?.textContent)

      expect(input.value).toBe('initial value')
      expect(display.textContent).toBe('initial value')
    })

    it('updates state when nested list input changes', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-model-update">
          <div data-list="items">
            <template>
              <div class="item">
                <div data-list="subitems">
                  <template>
                    <div class="subitem-wrapper">
                      <input type="text" data-model="text">
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-model-update', {
        state: {
          items: [
            { id: 1, subitems: [
              { id: 101, text: 'original' }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      const input = testContainer.querySelector('[data-list="subitems"] > :not(template) input')

      // Simulate user typing
      input.value = 'modified'
      input.dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate(100)

      // Check state was updated
      expect(componentInstance.state.items[0].subitems[0].text).toBe('modified')
    })

    it('handles checkboxes in nested lists', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-checkbox">
          <div data-list="categories">
            <template>
              <div class="category">
                <div data-list="options">
                  <template>
                    <label>
                      <input type="checkbox" data-model="selected">
                      <span data-bind="label"></span>
                    </label>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-checkbox', {
        state: {
          categories: [
            { id: 1, options: [
              { id: 101, label: 'Option A', selected: true },
              { id: 102, label: 'Option B', selected: false }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      const checkboxes = testContainer.querySelectorAll('[data-list="options"] > :not(template) input')
      expect(checkboxes[0].checked).toBe(true)
      expect(checkboxes[1].checked).toBe(false)

      // Toggle checkbox
      checkboxes[1].checked = true
      checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }))

      await waitForUpdate()

      expect(componentInstance.state.categories[0].options[1].selected).toBe(true)
    })
  })

  // ============================================================
  // CONDITIONAL RENDERING IN NESTED LISTS
  // ============================================================

  describe('Conditional Rendering in Nested Lists', () => {

    it('handles data-show in nested list items', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-show">
          <div data-list="groups">
            <template>
              <div class="group">
                <div data-list="members">
                  <template>
                    <div class="member">
                      <span data-bind="name"></span>
                      <span class="badge" data-show="isAdmin">Admin</span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-show', {
        state: {
          groups: [
            { id: 1, members: [
              { id: 101, name: 'User 1', isAdmin: true },
              { id: 102, name: 'User 2', isAdmin: false }
            ]}
          ]
        }
      })

      await waitForCompleteRender()

      const members = testContainer.querySelectorAll('[data-list="members"] > :not(template)')
      const badge1 = members[0].querySelector('.badge')
      const badge2 = members[1].querySelector('.badge')

      // data-show typically sets display: none when false
      expect(badge1.style.display).not.toBe('none')
      expect(badge2.style.display).toBe('none')
    })

    it('handles data-render in nested list items', async () => {
      testContainer.innerHTML = `
        <div data-component="nested-render">
          <div data-list="containers">
            <template>
              <div class="container">
                <div data-list="elements">
                  <template>
                    <div class="element">
                      <span data-bind="text"></span>
                      <div data-render="showDetails" class="details">
                        <span data-bind="description"></span>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('nested-render', {
        state: {
          containers: [
            { id: 1, elements: [
              { id: 101, text: 'Element 1', showDetails: true, description: 'Details 1' },
              { id: 102, text: 'Element 2', showDetails: false, description: 'Details 2' }
            ]}
          ]
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(200) // Extra time for data-render DOM removal

      const elements = testContainer.querySelectorAll('[data-list="elements"] > :not(template)')

      // data-render removes/adds elements from DOM
      const details1 = elements[0].querySelector('.details')
      const details2 = elements[1].querySelector('.details')

      // Element with showDetails: true should have details
      expect(details1).not.toBeNull()
      expect(details1.textContent).toContain('Details 1')

      // Element with showDetails: false should not have details in DOM
      expect(details2).toBeNull()
    })

    it('toggles conditional content in nested lists dynamically', async () => {
      testContainer.innerHTML = `
        <div data-component="toggle-nested-cond">
          <div data-list="panels">
            <template>
              <div class="panel">
                <div data-list="sections">
                  <template>
                    <div class="section">
                      <span class="expanded-content" data-show="expanded">Expanded!</span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('toggle-nested-cond', {
        state: {
          panels: [
            { id: 1, sections: [
              { id: 101, expanded: false }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(150)

      let expandedContent = testContainer.querySelector('.expanded-content')
      expect(expandedContent.style.display).toBe('none')

      // Toggle expanded
      componentInstance.state.panels = [{
        ...componentInstance.state.panels[0],
        sections: [{ id: 101, expanded: true }]
      }]

      await waitForCompleteRender()
      await waitForUpdate(200)

      expandedContent = testContainer.querySelector('.expanded-content')
      expect(expandedContent.style.display).not.toBe('none')
    })
  })

  // ============================================================
  // COMPLEX DOM STRUCTURES
  // ============================================================

  describe('Complex DOM Structures', () => {

    it('handles deeply nested sibling lists', async () => {
      testContainer.innerHTML = `
        <div data-component="sibling-nested-lists">
          <div data-list="sections">
            <template>
              <div class="section">
                <span data-bind="title"></span>
                <div class="list-a-container">
                  <div data-list="listA">
                    <template>
                      <span class="item-a" data-bind="value"></span>
                    </template>
                  </div>
                </div>
                <div class="list-b-container">
                  <div data-list="listB">
                    <template>
                      <span class="item-b" data-bind="value"></span>
                    </template>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('sibling-nested-lists', {
        state: {
          sections: [
            {
              id: 1,
              title: 'Section 1',
              listA: [{ id: 'a1', value: 'A-1' }, { id: 'a2', value: 'A-2' }],
              listB: [{ id: 'b1', value: 'B-1' }]
            }
          ]
        }
      })

      await waitForCompleteRender()

      const itemsA = testContainer.querySelectorAll('.item-a')
      const itemsB = testContainer.querySelectorAll('.item-b')

      expect(itemsA.length).toBe(2)
      expect(itemsB.length).toBe(1)
      expect(itemsA[0].textContent).toBe('A-1')
      expect(itemsA[1].textContent).toBe('A-2')
      expect(itemsB[0].textContent).toBe('B-1')
    })

    it('handles 4-level nesting', async () => {
      testContainer.innerHTML = `
        <div data-component="four-level-nested">
          <div data-list="level1">
            <template>
              <div class="l1">
                <span class="l1-name" data-bind="name"></span>
                <div data-list="level2">
                  <template>
                    <div class="l2">
                      <span class="l2-name" data-bind="name"></span>
                      <div data-list="level3">
                        <template>
                          <div class="l3">
                            <span class="l3-name" data-bind="name"></span>
                            <div data-list="level4">
                              <template>
                                <span class="l4-name" data-bind="name"></span>
                              </template>
                            </div>
                          </div>
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

      wildflower.component('four-level-nested', {
        state: {
          level1: [{
            id: 1, name: 'L1',
            level2: [{
              id: 2, name: 'L2',
              level3: [{
                id: 3, name: 'L3',
                level4: [{ id: 4, name: 'L4' }]
              }]
            }]
          }]
        }
      })

      await waitForCompleteRender()

      expect(testContainer.querySelector('.l1-name').textContent).toBe('L1')
      expect(testContainer.querySelector('.l2-name').textContent).toBe('L2')
      expect(testContainer.querySelector('.l3-name').textContent).toBe('L3')
      expect(testContainer.querySelector('.l4-name').textContent).toBe('L4')
    })

    it('handles mixed content with bindings, actions, and lists', async () => {
      testContainer.innerHTML = `
        <div data-component="mixed-content">
          <div data-list="cards">
            <template>
              <div class="card">
                <h3 class="title" data-bind="title"></h3>
                <p class="desc" data-bind="description"></p>
                <span class="status-badge" data-bind-class="status"></span>
                <button class="toggle-btn" data-action="toggleStatus">Toggle</button>
                <div data-list="tags">
                  <template>
                    <span class="tag" data-bind-class="color" data-bind="label"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('mixed-content', {
        state: {
          cards: [{
            id: 1,
            title: 'Card Title',
            description: 'Card description',
            status: 'pending',
            tags: [
              { id: 't1', label: 'Tag 1', color: 'blue' },
              { id: 't2', label: 'Tag 2', color: 'green' }
            ]
          }]
        },
        toggleStatus(event, element, { index: cardIndex }) {
          const cards = [...this.state.cards]
          cards[cardIndex] = {
            ...cards[cardIndex],
            status: cards[cardIndex].status === 'pending' ? 'complete' : 'pending'
          }
          this.state.cards = cards
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify all bindings
      expect(testContainer.querySelector('.title').textContent).toBe('Card Title')
      expect(testContainer.querySelector('.desc').textContent).toBe('Card description')
      expect(testContainer.querySelector('.status-badge').classList.contains('pending')).toBe(true)

      const tags = testContainer.querySelectorAll('.tag')
      expect(tags.length).toBe(2)
      expect(tags[0].textContent).toBe('Tag 1')
      expect(tags[0].classList.contains('blue')).toBe(true)

      // Click toggle button
      testContainer.querySelector('.toggle-btn').click()
      await waitForCompleteRender()

      expect(testContainer.querySelector('.status-badge').classList.contains('complete')).toBe(true)
    })
  })

  // ============================================================
  // EDGE CASES
  // ============================================================

  describe('Edge Cases', () => {

    it('handles empty nested list within populated parent list', async () => {
      testContainer.innerHTML = `
        <div data-component="empty-nested">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('empty-nested', {
        state: {
          projects: [
            { id: 1, name: 'Project with tasks', tasks: [{ id: 101, title: 'Task 1' }] },
            { id: 2, name: 'Empty project', tasks: [] },
            { id: 3, name: 'Another with tasks', tasks: [{ id: 301, title: 'Task A' }] }
          ]
        }
      })

      await waitForCompleteRender()

      const projects = testContainer.querySelectorAll('[data-list="projects"] > :not(template)')
      expect(projects.length).toBe(3)

      // Verify first project has tasks
      const p1Tasks = projects[0].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(p1Tasks.length).toBe(1)

      // Verify second project has no tasks
      const p2Tasks = projects[1].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(p2Tasks.length).toBe(0)

      // Verify third project has tasks
      const p3Tasks = projects[2].querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(p3Tasks.length).toBe(1)
    })

    it('handles adding first item to empty nested list', async () => {
      testContainer.innerHTML = `
        <div data-component="first-nested-item">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('first-nested-item', {
        state: {
          projects: [
            { id: 1, name: 'Empty Project', tasks: [] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initially empty
      let tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(0)

      // Add first task
      const project = componentInstance.state.projects[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: [{ id: 101, title: 'First Task' }]
      }]

      await waitForCompleteRender()

      // Verify task appears
      tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(1)
      expect(tasks[0].querySelector('.task-title').textContent).toBe('First Task')
    })

    it('handles removing last item from nested list', async () => {
      testContainer.innerHTML = `
        <div data-component="remove-last-nested">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <span class="task-title" data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('remove-last-nested', {
        state: {
          projects: [
            { id: 1, name: 'Project', tasks: [{ id: 101, title: 'Only Task' }] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify task exists
      let tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(1)

      // Remove the only task
      const project = componentInstance.state.projects[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: []
      }]

      await waitForCompleteRender()

      // Verify list is now empty
      tasks = testContainer.querySelectorAll('[data-list="tasks"] > :not(template)')
      expect(tasks.length).toBe(0)

      // Verify project name still displays
      expect(testContainer.querySelector('.project-name').textContent).toBe('Project')
    })

    it('handles null/undefined in nested array properties gracefully', async () => {
      testContainer.innerHTML = `
        <div data-component="null-nested">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name" data-bind="name"></span>
                <div data-list="children">
                  <template>
                    <span class="child" data-bind="value"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('null-nested', {
        state: {
          items: [
            { id: 1, name: 'Has children', children: [{ id: 101, value: 'Child 1' }] },
            { id: 2, name: 'Null children', children: null },
            { id: 3, name: 'Undefined children' }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Should not throw and should render the items
      const items = testContainer.querySelectorAll('[data-list="items"] > :not(template)')
      expect(items.length).toBe(3)
      expect(items[0].querySelector('.name').textContent).toBe('Has children')
      expect(items[1].querySelector('.name').textContent).toBe('Null children')
      expect(items[2].querySelector('.name').textContent).toBe('Undefined children')

      // First item should have children
      const children = items[0].querySelectorAll('[data-list="children"] > :not(template)')
      expect(children.length).toBe(1)
    })

    it('handles rapid successive operations without corruption', async () => {
      testContainer.innerHTML = `
        <div data-component="rapid-ops">
          <div data-list="items">
            <template>
              <div class="item">
                <span data-bind="name"></span>
                <div data-list="subs">
                  <template>
                    <span class="sub" data-bind="label"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('rapid-ops', {
        state: {
          items: [
            { id: 1, name: 'Item 1', subs: [{ id: 's1', label: 'Sub 1' }] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Rapid-fire operations - add items sequentially with minimal wait
      for (let i = 2; i <= 5; i++) {
        componentInstance.state.items = [
          ...componentInstance.state.items,
          { id: i, name: `Item ${i}`, subs: [{ id: `s${i}`, label: `Sub ${i}` }] }
        ]
        await waitForUpdate(50) // Small delay between operations
      }

      await waitForCompleteRender()
      await waitForUpdate(200) // Extra settling time

      const items = testContainer.querySelectorAll('[data-list="items"] > :not(template)')
      expect(items.length).toBe(5)

      // Verify all nested lists rendered correctly
      for (let i = 0; i < 5; i++) {
        const subs = items[i].querySelectorAll('[data-list="subs"] > :not(template)')
        expect(subs.length).toBe(1)
        expect(subs[0].textContent).toBe(`Sub ${i + 1}`)
      }
    })

    it('handles swapping items in nested lists', async () => {
      testContainer.innerHTML = `
        <div data-component="swap-nested">
          <div data-list="rows">
            <template>
              <div class="row">
                <span class="row-name" data-bind="name"></span>
                <div data-list="cells">
                  <template>
                    <span class="cell" data-bind="value"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('swap-nested', {
        state: {
          rows: [
            { id: 1, name: 'Row 1', cells: [{ id: 'c1', value: 'A' }, { id: 'c2', value: 'B' }] },
            { id: 2, name: 'Row 2', cells: [{ id: 'c3', value: 'C' }, { id: 'c4', value: 'D' }] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Swap rows
      componentInstance.state.rows = [
        componentInstance.state.rows[1],
        componentInstance.state.rows[0]
      ]

      await waitForCompleteRender()

      const rows = testContainer.querySelectorAll('[data-list="rows"] > :not(template)')
      expect(rows[0].querySelector('.row-name').textContent).toBe('Row 2')
      expect(rows[1].querySelector('.row-name').textContent).toBe('Row 1')

      // Verify nested cells swapped correctly
      const row1Cells = rows[0].querySelectorAll('.cell')
      const row2Cells = rows[1].querySelectorAll('.cell')

      expect(row1Cells[0].textContent).toBe('C')
      expect(row1Cells[1].textContent).toBe('D')
      expect(row2Cells[0].textContent).toBe('A')
      expect(row2Cells[1].textContent).toBe('B')
    })

    it('handles updating property in nested item without replacing array', async () => {
      testContainer.innerHTML = `
        <div data-component="update-property">
          <div data-list="parents">
            <template>
              <div class="parent">
                <div data-list="children">
                  <template>
                    <div class="child">
                      <span class="label" data-bind="label"></span>
                      <span class="count" data-bind="count"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('update-property', {
        state: {
          parents: [
            { id: 1, children: [
              { id: 101, label: 'Child A', count: 0 },
              { id: 102, label: 'Child B', count: 0 }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Update just the count on second child
      const parent = componentInstance.state.parents[0]
      componentInstance.state.parents = [{
        ...parent,
        children: [
          parent.children[0],
          { ...parent.children[1], count: 5 }
        ]
      }]

      await waitForCompleteRender()

      const children = testContainer.querySelectorAll('[data-list="children"] > :not(template)')
      expect(children[0].querySelector('.count').textContent).toBe('0')
      expect(children[1].querySelector('.count').textContent).toBe('5')

      // Labels should be unchanged
      expect(children[0].querySelector('.label').textContent).toBe('Child A')
      expect(children[1].querySelector('.label').textContent).toBe('Child B')
    })

    it('handles multiple sibling nested lists in same parent item', async () => {
      testContainer.innerHTML = `
        <div data-component="sibling-lists">
          <div data-list="containers">
            <template>
              <div class="container">
                <h3 data-bind="title"></h3>
                <div class="left-list">
                  <div data-list="leftItems">
                    <template>
                      <span class="left" data-bind="name"></span>
                    </template>
                  </div>
                </div>
                <div class="right-list">
                  <div data-list="rightItems">
                    <template>
                      <span class="right" data-bind="name"></span>
                    </template>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('sibling-lists', {
        state: {
          containers: [
            {
              id: 1,
              title: 'Container 1',
              leftItems: [{ id: 'l1', name: 'Left 1' }],
              rightItems: [{ id: 'r1', name: 'Right 1' }, { id: 'r2', name: 'Right 2' }]
            }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      let leftItems = testContainer.querySelectorAll('.left')
      let rightItems = testContainer.querySelectorAll('.right')

      expect(leftItems.length).toBe(1)
      expect(rightItems.length).toBe(2)

      // Add to left list only
      const container = componentInstance.state.containers[0]
      componentInstance.state.containers = [{
        ...container,
        leftItems: [...container.leftItems, { id: 'l2', name: 'Left 2' }]
      }]

      await waitForCompleteRender()

      leftItems = testContainer.querySelectorAll('.left')
      rightItems = testContainer.querySelectorAll('.right')

      expect(leftItems.length).toBe(2)
      expect(rightItems.length).toBe(2) // Should remain unchanged
      expect(leftItems[1].textContent).toBe('Left 2')
      expect(rightItems[0].textContent).toBe('Right 1')
    })

    it('handles complete replacement of nested array', async () => {
      testContainer.innerHTML = `
        <div data-component="replace-array">
          <div data-list="groups">
            <template>
              <div class="group">
                <span class="group-name" data-bind="name"></span>
                <div data-list="members">
                  <template>
                    <span class="member" data-bind="username"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('replace-array', {
        state: {
          groups: [
            { id: 1, name: 'Group 1', members: [
              { id: 'm1', username: 'user1' },
              { id: 'm2', username: 'user2' }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Completely replace members array with different items
      componentInstance.state.groups = [{
        id: 1,
        name: 'Group 1',
        members: [
          { id: 'm3', username: 'newuser1' },
          { id: 'm4', username: 'newuser2' },
          { id: 'm5', username: 'newuser3' }
        ]
      }]

      await waitForCompleteRender()

      const members = testContainer.querySelectorAll('.member')
      expect(members.length).toBe(3)
      expect(members[0].textContent).toBe('newuser1')
      expect(members[1].textContent).toBe('newuser2')
      expect(members[2].textContent).toBe('newuser3')
    })

    it('handles falsy values in nested list item bindings', async () => {
      testContainer.innerHTML = `
        <div data-component="falsy-nested">
          <div data-list="items">
            <template>
              <div class="item">
                <div data-list="values">
                  <template>
                    <span class="value" data-bind="num"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      wildflower.component('falsy-nested', {
        state: {
          items: [
            { id: 1, values: [
              { id: 'v1', num: 0 },
              { id: 'v2', num: '' },
              { id: 'v3', num: false },
              { id: 'v4', num: null }
            ]}
          ]
        }
      })

      await waitForCompleteRender()

      const values = testContainer.querySelectorAll('.value')
      expect(values.length).toBe(4)
      expect(values[0].textContent).toBe('0')
      expect(values[1].textContent).toBe('')
      expect(values[2].textContent).toBe('false')
      expect(values[3].textContent).toBe('')
    })
  })

  // ============================================================
  // STRESS TESTS
  // ============================================================

  describe('Stress Tests', () => {

    it('handles large nested list (100 parents x 10 children)', async () => {
      testContainer.innerHTML = `
        <div data-component="large-nested">
          <div data-list="parents">
            <template>
              <div class="parent">
                <span class="parent-name" data-bind="name"></span>
                <div data-list="children">
                  <template>
                    <span class="child-name" data-bind="name"></span>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      // Create 100 parents with 10 children each
      const parents = []
      for (let i = 0; i < 100; i++) {
        const children = []
        for (let j = 0; j < 10; j++) {
          children.push({ id: `c${i}-${j}`, name: `Child ${j}` })
        }
        parents.push({ id: i, name: `Parent ${i}`, children })
      }

      wildflower.component('large-nested', {
        state: { parents }
      })

      await waitForCompleteRender()
      await waitForUpdate(100) // Extra time for large list

      const parentElements = testContainer.querySelectorAll('[data-list="parents"] > :not(template)')
      expect(parentElements.length).toBe(100)

      // Spot check a few parents
      expect(parentElements[0].querySelector('.parent-name').textContent).toBe('Parent 0')
      expect(parentElements[50].querySelector('.parent-name').textContent).toBe('Parent 50')
      expect(parentElements[99].querySelector('.parent-name').textContent).toBe('Parent 99')

      // Check children count in a few parents
      const p0Children = parentElements[0].querySelectorAll('[data-list="children"] > :not(template)')
      const p50Children = parentElements[50].querySelectorAll('[data-list="children"] > :not(template)')
      expect(p0Children.length).toBe(10)
      expect(p50Children.length).toBe(10)
    })

    it('handles deep nesting with operations at each level', async () => {
      testContainer.innerHTML = `
        <div data-component="deep-ops">
          <div data-list="a">
            <template>
              <div class="level-a">
                <span class="a-name" data-bind="name"></span>
                <div data-list="b">
                  <template>
                    <div class="level-b">
                      <span class="b-name" data-bind="name"></span>
                      <div data-list="c">
                        <template>
                          <div class="level-c">
                            <span class="c-name" data-bind="name"></span>
                          </div>
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

      let componentInstance
      wildflower.component('deep-ops', {
        state: {
          a: [{
            id: 1, name: 'A1',
            b: [{
              id: 2, name: 'B1',
              c: [{ id: 3, name: 'C1' }]
            }]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()
      await waitForUpdate(150)

      // Add at level C
      let a = componentInstance.state.a[0]
      let b = a.b[0]
      componentInstance.state.a = [{
        ...a,
        b: [{
          ...b,
          c: [...b.c, { id: 4, name: 'C2' }]
        }]
      }]

      await waitForCompleteRender()
      await waitForUpdate(200)

      let cItems = testContainer.querySelectorAll('.c-name')
      expect(cItems.length).toBe(2)

      // Add at level B
      a = componentInstance.state.a[0]
      componentInstance.state.a = [{
        ...a,
        b: [...a.b, { id: 5, name: 'B2', c: [{ id: 6, name: 'C3' }] }]
      }]

      await waitForCompleteRender()
      await waitForUpdate(200)

      const bItems = testContainer.querySelectorAll('.b-name')
      cItems = testContainer.querySelectorAll('.c-name')
      expect(bItems.length).toBe(2)
      expect(cItems.length).toBe(3)

      // Add at level A
      componentInstance.state.a = [
        ...componentInstance.state.a,
        { id: 7, name: 'A2', b: [{ id: 8, name: 'B3', c: [] }] }
      ]

      await waitForCompleteRender()
      await waitForUpdate(200)

      const aItems = testContainer.querySelectorAll('.a-name')
      expect(aItems.length).toBe(2)
    })
  })

  // ============================================================
  // ADVANCED NESTED LIST SCENARIOS
  // These tests cover edge cases discovered during debugging
  // ============================================================

  describe('Advanced Nested List Scenarios', () => {

    it('propagates state changes through 3+ level nesting via model input', async () => {
      // Tests that _updateNestedListState correctly traverses the parent chain
      testContainer.innerHTML = `
        <div data-component="deep-model-propagation">
          <div data-list="level1">
            <template>
              <div class="l1">
                <span class="l1-name" data-bind="name"></span>
                <div data-list="level2">
                  <template>
                    <div class="l2">
                      <span class="l2-name" data-bind="name"></span>
                      <div data-list="level3">
                        <template>
                          <div class="l3">
                            <span class="l3-name" data-bind="name"></span>
                            <div data-list="level4">
                              <template>
                                <div class="l4">
                                  <input type="text" class="l4-input" data-model="value">
                                  <span class="l4-display" data-bind="value"></span>
                                </div>
                              </template>
                            </div>
                          </div>
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

      let componentInstance
      wildflower.component('deep-model-propagation', {
        state: {
          level1: [{
            id: 1, name: 'L1',
            level2: [{
              id: 2, name: 'L2',
              level3: [{
                id: 3, name: 'L3',
                level4: [{ id: 4, value: 'initial' }]
              }]
            }]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      const input = testContainer.querySelector('.l4-input')
      const display = testContainer.querySelector('.l4-display')
      expect(input.value).toBe('initial')
      expect(display.textContent).toBe('initial')

      // Change value via input
      input.value = 'changed-at-level-4'
      input.dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate()

      // Verify state propagated all the way up
      expect(componentInstance.state.level1[0].level2[0].level3[0].level4[0].value).toBe('changed-at-level-4')
    })

    it('preserves nested list input values when parent item updates unrelated property', async () => {
      // Tests that updating parent properties doesn't reset nested list inputs
      testContainer.innerHTML = `
        <div data-component="preserve-nested-inputs">
          <div data-list="parents">
            <template>
              <div class="parent">
                <span class="parent-title" data-bind="title"></span>
                <span class="parent-count" data-bind="viewCount"></span>
                <div data-list="children">
                  <template>
                    <div class="child">
                      <input type="text" class="child-input" data-model="text">
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('preserve-nested-inputs', {
        state: {
          parents: [{
            id: 1,
            title: 'Parent Title',
            viewCount: 0,
            children: [
              { id: 101, text: 'Child 1 text' },
              { id: 102, text: 'Child 2 text' }
            ]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Get initial input values
      const inputs = testContainer.querySelectorAll('.child-input')
      expect(inputs[0].value).toBe('Child 1 text')
      expect(inputs[1].value).toBe('Child 2 text')

      // User types in second input (simulating user interaction)
      inputs[1].value = 'User typed this'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate()

      // Now update an UNRELATED parent property (viewCount)
      const parent = componentInstance.state.parents[0]
      componentInstance.state.parents = [{
        ...parent,
        viewCount: parent.viewCount + 1
      }]

      await waitForCompleteRender()

      // Child input values should be preserved
      const updatedInputs = testContainer.querySelectorAll('.child-input')
      expect(updatedInputs[0].value).toBe('Child 1 text')
      expect(updatedInputs[1].value).toBe('User typed this')
    })

    it('handles mixed binding types on same nested element', async () => {
      // Tests that data-bind-class and data-bind both work together on nested list items
      testContainer.innerHTML = `
        <div data-component="mixed-bindings-nested">
          <div data-list="categories">
            <template>
              <div class="category">
                <div data-list="items">
                  <template>
                    <div class="item" data-bind-class="status ? 'active' : ''" data-bind="label">
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('mixed-bindings-nested', {
        state: {
          categories: [{
            id: 1,
            items: [
              { id: 101, label: 'Item A', status: true },
              { id: 102, label: 'Item B', status: false },
              { id: 103, label: 'Item C', status: true }
            ]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      const items = testContainer.querySelectorAll('.item')

      // Check both text content and class bindings
      expect(items[0].textContent.trim()).toBe('Item A')
      expect(items[0].classList.contains('active')).toBe(true)

      expect(items[1].textContent.trim()).toBe('Item B')
      expect(items[1].classList.contains('active')).toBe(false)

      expect(items[2].textContent.trim()).toBe('Item C')
      expect(items[2].classList.contains('active')).toBe(true)

      // Update both properties
      const category = componentInstance.state.categories[0]
      componentInstance.state.categories = [{
        ...category,
        items: [
          { id: 101, label: 'Updated A', status: false },
          category.items[1],
          category.items[2]
        ]
      }]

      await waitForCompleteRender()

      const updatedItems = testContainer.querySelectorAll('.item')
      expect(updatedItems[0].textContent.trim()).toBe('Updated A')
      expect(updatedItems[0].classList.contains('active')).toBe(false)
    })

    it('maintains correct model bindings after TOP-LEVEL list splice', async () => {
      // Simpler test case: top-level list (not nested) to isolate the issue
      testContainer.innerHTML = `
        <div data-component="toplevel-splice-test">
          <div data-list="members">
            <template>
              <div class="member">
                <input type="text" class="member-input" data-model="name">
                <span class="member-display" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('toplevel-splice-test', {
        state: {
          members: [
            { id: 101, name: 'Alice' },
            { id: 102, name: 'Bob' },
            { id: 103, name: 'Charlie' }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Remove middle item (Bob)
      componentInstance.state.members = [
        componentInstance.state.members[0],  // Alice stays at 0
        componentInstance.state.members[2]   // Charlie moves to 1
      ]

      await waitForCompleteRender()

      // Verify Charlie is now at index 1
      const inputs = testContainer.querySelectorAll('.member-input')
      expect(inputs.length).toBe(2)
      expect(inputs[0].value).toBe('Alice')
      expect(inputs[1].value).toBe('Charlie')

      // Change Charlie's name via input
      inputs[1].value = 'Charles'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate()

      // Verify state was updated correctly at index 1
      expect(componentInstance.state.members[1].name).toBe('Charles')
      expect(componentInstance.state.members[0].name).toBe('Alice')
    })

    // Verifies that after splice operations, model bindings point to correct items
    it('maintains correct model bindings after parent array splice', async () => {
      // Tests that after splice operations, nested list model bindings point to correct items
      testContainer.innerHTML = `
        <div data-component="splice-model-test">
          <div data-list="groups">
            <template>
              <div class="group">
                <span class="group-name" data-bind="name"></span>
                <div data-list="members">
                  <template>
                    <div class="member">
                      <input type="text" class="member-name-input" data-model="name">
                      <input type="checkbox" class="member-active" data-model="active">
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('splice-model-test', {
        state: {
          groups: [
            { id: 1, name: 'Group A', members: [
              { id: 101, name: 'Alice', active: true },
              { id: 102, name: 'Bob', active: false },
              { id: 103, name: 'Charlie', active: true }
            ]},
            { id: 2, name: 'Group B', members: [
              { id: 201, name: 'Dave', active: false }
            ]}
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Remove middle member (Bob) from Group A
      const groupA = componentInstance.state.groups[0]
      componentInstance.state.groups = [
        {
          ...groupA,
          members: [groupA.members[0], groupA.members[2]] // Skip Bob
        },
        componentInstance.state.groups[1]
      ]

      await waitForCompleteRender()

      // Now modify Charlie (who is now at index 1)
      const firstGroup = testContainer.querySelectorAll('[data-list="groups"] > :not(template)')[0]
      const inputs = firstGroup.querySelectorAll('.member-name-input')
      expect(inputs.length).toBe(2)
      expect(inputs[0].value).toBe('Alice')
      expect(inputs[1].value).toBe('Charlie')

      // Change Charlie's name via input
      inputs[1].value = 'Charles'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate()

      // Verify correct item was updated (Charlie, not some stale reference)
      expect(componentInstance.state.groups[0].members[1].name).toBe('Charles')
      expect(componentInstance.state.groups[0].members[0].name).toBe('Alice') // Unchanged
    })

    it('maintains isolation between multiple nested lists in same parent', async () => {
      // Tests that modifying one nested list doesn't affect sibling nested lists
      testContainer.innerHTML = `
        <div data-component="isolated-siblings">
          <div data-list="containers">
            <template>
              <div class="container">
                <h3 data-bind="title"></h3>
                <div class="tasks-section">
                  <div data-list="tasks">
                    <template>
                      <div class="task">
                        <input type="text" class="task-input" data-model="text">
                      </div>
                    </template>
                  </div>
                </div>
                <div class="comments-section">
                  <div data-list="comments">
                    <template>
                      <div class="comment">
                        <input type="text" class="comment-input" data-model="text">
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('isolated-siblings', {
        state: {
          containers: [{
            id: 1,
            title: 'Container 1',
            tasks: [
              { id: 't1', text: 'Task 1' },
              { id: 't2', text: 'Task 2' }
            ],
            comments: [
              { id: 'c1', text: 'Comment 1' },
              { id: 'c2', text: 'Comment 2' }
            ]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Modify a task input
      const taskInputs = testContainer.querySelectorAll('.task-input')
      taskInputs[0].value = 'Modified Task 1'
      taskInputs[0].dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate()

      // Verify task was updated
      expect(componentInstance.state.containers[0].tasks[0].text).toBe('Modified Task 1')

      // Verify comments were NOT affected
      expect(componentInstance.state.containers[0].comments[0].text).toBe('Comment 1')
      expect(componentInstance.state.containers[0].comments[1].text).toBe('Comment 2')

      // Now modify a comment
      const commentInputs = testContainer.querySelectorAll('.comment-input')
      commentInputs[1].value = 'Modified Comment 2'
      commentInputs[1].dispatchEvent(new Event('input', { bubbles: true }))

      await waitForUpdate()

      // Verify comment was updated
      expect(componentInstance.state.containers[0].comments[1].text).toBe('Modified Comment 2')

      // Verify tasks were NOT affected
      expect(componentInstance.state.containers[0].tasks[0].text).toBe('Modified Task 1')
      expect(componentInstance.state.containers[0].tasks[1].text).toBe('Task 2')
    })

    it('updates computed properties that reference nested list data', async () => {
      // Tests that computed properties correctly react to nested list changes
      testContainer.innerHTML = `
        <div data-component="computed-nested">
          <div class="summary">
            <span class="total-items" data-bind="computed:totalItems"></span>
            <span class="completed-count" data-bind="computed:completedCount"></span>
          </div>
          <div data-list="categories">
            <template>
              <div class="category">
                <span class="cat-name" data-bind="name"></span>
                <div data-list="items">
                  <template>
                    <div class="item">
                      <input type="checkbox" class="item-done" data-model="done">
                      <span data-bind="title"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('computed-nested', {
        state: {
          categories: [
            { id: 1, name: 'Work', items: [
              { id: 101, title: 'Task 1', done: true },
              { id: 102, title: 'Task 2', done: false }
            ]},
            { id: 2, name: 'Home', items: [
              { id: 201, title: 'Task A', done: false },
              { id: 202, title: 'Task B', done: true },
              { id: 203, title: 'Task C', done: false }
            ]}
          ]
        },
        computed: {
          totalItems() {
            return this.state.categories.reduce((sum, cat) => sum + cat.items.length, 0)
          },
          completedCount() {
            return this.state.categories.reduce((sum, cat) =>
              sum + cat.items.filter(item => item.done).length, 0)
          }
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial computed values
      expect(testContainer.querySelector('.total-items').textContent).toBe('5')
      expect(testContainer.querySelector('.completed-count').textContent).toBe('2')

      // Toggle a checkbox to mark item as done
      const checkboxes = testContainer.querySelectorAll('.item-done')
      checkboxes[1].checked = true // Task 2 in Work category
      checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }))

      await waitForUpdate()
      await waitForCompleteRender()

      // Verify computed updated
      expect(componentInstance.state.categories[0].items[1].done).toBe(true)
      expect(testContainer.querySelector('.completed-count').textContent).toBe('3')

      // Add a new item to nested list
      const workCategory = componentInstance.state.categories[0]
      componentInstance.state.categories = [
        {
          ...workCategory,
          items: [...workCategory.items, { id: 103, title: 'Task 3', done: true }]
        },
        componentInstance.state.categories[1]
      ]

      await waitForCompleteRender()

      // Verify both computed values updated
      expect(testContainer.querySelector('.total-items').textContent).toBe('6')
      expect(testContainer.querySelector('.completed-count').textContent).toBe('4')
    })

    // Tests for all binding types after splice
    it('maintains all binding types correctly after parent splice (data-bind, data-bind-class, data-show)', async () => {
      testContainer.innerHTML = `
        <div data-component="all-bindings-splice">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="name-display" data-bind="name"></span>
                <span class="status-badge" data-bind-class="active ? 'active' : 'inactive'"></span>
                <span class="active-indicator" data-show="active">[ACTIVE]</span>
                <span class="inactive-indicator" data-show="!active">[INACTIVE]</span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('all-bindings-splice', {
        state: {
          items: [
            { id: 1, name: 'Alice', active: true },
            { id: 2, name: 'Bob', active: false },
            { id: 3, name: 'Charlie', active: true }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      const getItemElements = () => testContainer.querySelectorAll('.item')
      let items = getItemElements()
      expect(items.length).toBe(3)

      // Verify Charlie's bindings before splice
      expect(items[2].querySelector('.name-display').textContent).toBe('Charlie')
      expect(items[2].querySelector('.status-badge').classList.contains('active')).toBe(true)
      expect(items[2].querySelector('.active-indicator').style.display).not.toBe('none')
      expect(items[2].querySelector('.inactive-indicator').style.display).toBe('none')

      // Remove Bob (middle item) - Charlie moves from index 2 to index 1
      componentInstance.state.items = [
        componentInstance.state.items[0],  // Alice
        componentInstance.state.items[2]   // Charlie
      ]

      await waitForCompleteRender()

      // Verify we now have 2 items
      items = getItemElements()
      expect(items.length).toBe(2)

      // Verify Alice (index 0) - unchanged
      expect(items[0].querySelector('.name-display').textContent).toBe('Alice')
      expect(items[0].querySelector('.status-badge').classList.contains('active')).toBe(true)
      expect(items[0].querySelector('.active-indicator').style.display).not.toBe('none')

      // Verify Charlie (now at index 1) - all bindings should still work correctly
      expect(items[1].querySelector('.name-display').textContent).toBe('Charlie')
      expect(items[1].querySelector('.status-badge').classList.contains('active')).toBe(true)
      expect(items[1].querySelector('.active-indicator').style.display).not.toBe('none')
      expect(items[1].querySelector('.inactive-indicator').style.display).toBe('none')

      // Now modify Charlie's state and verify bindings update correctly
      componentInstance.state.items = [
        componentInstance.state.items[0],
        { ...componentInstance.state.items[1], active: false }
      ]

      await waitForCompleteRender()

      items = getItemElements()
      // Charlie's bindings should reflect the new state
      expect(items[1].querySelector('.status-badge').classList.contains('inactive')).toBe(true)
      expect(items[1].querySelector('.status-badge').classList.contains('active')).toBe(false)
      expect(items[1].querySelector('.active-indicator').style.display).toBe('none')
      expect(items[1].querySelector('.inactive-indicator').style.display).not.toBe('none')
    })

    it('maintains action context correctness after splice', async () => {
      testContainer.innerHTML = `
        <div data-component="action-splice-test">
          <div data-list="items">
            <template>
              <div class="item">
                <span class="item-name" data-bind="name"></span>
                <button class="toggle-btn" data-action="toggleItem">Toggle</button>
                <button class="log-btn" data-action="logItem">Log</button>
              </div>
            </template>
          </div>
          <div class="log-output"></div>
        </div>
      `

      let componentInstance
      const actionLog = []

      wildflower.component('action-splice-test', {
        state: {
          items: [
            { id: 1, name: 'First', active: false },
            { id: 2, name: 'Second', active: false },
            { id: 3, name: 'Third', active: false }
          ]
        },
        init() {
          componentInstance = this
        },
        toggleItem(event, element, { index }) {
          actionLog.push({ action: 'toggle', index, itemName: this.state.items[index]?.name })

          // Toggle the item's active state
          this.state.items = this.state.items.map((item, i) =>
            i === index ? { ...item, active: !item.active } : item
          )
        },
        logItem(event, element, { index }) {
          actionLog.push({ action: 'log', index, itemName: this.state.items[index]?.name })
        }
      })

      await waitForCompleteRender()

      // Remove middle item (Second)
      componentInstance.state.items = [
        componentInstance.state.items[0],  // First
        componentInstance.state.items[2]   // Third (now at index 1)
      ]

      await waitForCompleteRender()

      // Clear action log
      actionLog.length = 0

      // Click toggle on what is now "Third" (at index 1)
      const toggleBtns = testContainer.querySelectorAll('.toggle-btn')
      expect(toggleBtns.length).toBe(2)

      toggleBtns[1].click()
      await waitForUpdate()

      // Verify the action operated on the correct item (Third, not Second)
      expect(actionLog.length).toBe(1)
      expect(actionLog[0].action).toBe('toggle')
      expect(actionLog[0].index).toBe(1)
      expect(actionLog[0].itemName).toBe('Third')
      expect(componentInstance.state.items[1].active).toBe(true)
      expect(componentInstance.state.items[1].name).toBe('Third')

      // Click log on First (index 0) to verify it still works
      actionLog.length = 0
      const logBtns = testContainer.querySelectorAll('.log-btn')
      logBtns[0].click()
      await waitForUpdate()

      expect(actionLog.length).toBe(1)
      expect(actionLog[0].action).toBe('log')
      expect(actionLog[0].index).toBe(0)
      expect(actionLog[0].itemName).toBe('First')
    })

    it('handles multiple consecutive removals correctly', async () => {
      testContainer.innerHTML = `
        <div data-component="consecutive-removals">
          <div data-list="items">
            <template>
              <div class="item">
                <input type="text" class="item-input" data-model="name">
                <span class="item-display" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('consecutive-removals', {
        state: {
          items: [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
            { id: 3, name: 'C' },
            { id: 4, name: 'D' },
            { id: 5, name: 'E' }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      const verifyBindings = async () => {
        const inputs = testContainer.querySelectorAll('.item-input')
        const displays = testContainer.querySelectorAll('.item-display')

        for (let i = 0; i < inputs.length; i++) {
          const expectedName = componentInstance.state.items[i].name
          expect(inputs[i].value).toBe(expectedName)
          expect(displays[i].textContent).toBe(expectedName)

          // Test model binding by changing input
          const newValue = expectedName + '-modified'
          inputs[i].value = newValue
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }))
          await waitForUpdate()

          expect(componentInstance.state.items[i].name).toBe(newValue)

          // Restore original value
          inputs[i].value = expectedName
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }))
          await waitForUpdate()
        }
      }

      // Remove B (index 1): [A, C, D, E]
      componentInstance.state.items = componentInstance.state.items.filter(item => item.name !== 'B')
      await waitForCompleteRender()
      expect(testContainer.querySelectorAll('.item').length).toBe(4)
      await verifyBindings()

      // Remove D (now at index 2): [A, C, E]
      componentInstance.state.items = componentInstance.state.items.filter(item => item.name !== 'D')
      await waitForCompleteRender()
      expect(testContainer.querySelectorAll('.item').length).toBe(3)
      await verifyBindings()

      // Remove A (index 0): [C, E]
      componentInstance.state.items = componentInstance.state.items.filter(item => item.name !== 'A')
      await waitForCompleteRender()
      expect(testContainer.querySelectorAll('.item').length).toBe(2)
      await verifyBindings()

      // Final state should be C and E
      expect(componentInstance.state.items[0].name).toBe('C')
      expect(componentInstance.state.items[1].name).toBe('E')
    })

    it('maintains bindings after insert in the middle of top-level list', async () => {
      testContainer.innerHTML = `
        <div data-component="insert-middle-toplevel">
          <div data-list="items">
            <template>
              <div class="item">
                <input type="text" class="item-input" data-model="name">
                <span class="item-display" data-bind="name"></span>
                <input type="checkbox" class="item-active" data-model="active">
                <span class="active-badge" data-show="active">[ON]</span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('insert-middle-toplevel', {
        state: {
          items: [
            { id: 1, name: 'First', active: true },
            { id: 2, name: 'Last', active: false }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      let items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0].querySelector('.item-display').textContent).toBe('First')
      expect(items[1].querySelector('.item-display').textContent).toBe('Last')

      // Insert new item in the middle
      componentInstance.state.items = [
        componentInstance.state.items[0],  // First
        { id: 3, name: 'Middle', active: true },  // New middle item
        componentInstance.state.items[1]   // Last (now at index 2)
      ]

      await waitForCompleteRender()

      // Verify 3 items now
      items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)

      // Verify display bindings
      expect(items[0].querySelector('.item-display').textContent).toBe('First')
      expect(items[1].querySelector('.item-display').textContent).toBe('Middle')
      expect(items[2].querySelector('.item-display').textContent).toBe('Last')

      // Verify model bindings work for the shifted item (Last, now at index 2)
      const lastInput = items[2].querySelector('.item-input')
      lastInput.value = 'Last-Modified'
      lastInput.dispatchEvent(new Event('input', { bubbles: true }))
      // Model changes on list items trigger array replacement + structural mapArray effect.
      // Use _forceCompleteRender to flush the legacy rAF pipeline synchronously,
      // then setTimeout(0) to flush the bulk array update batch queued via setTimeout(0),
      // then waitForCompleteRender to flush any re-triggered render.
      await waitForCompleteRender()
      await new Promise(resolve => setTimeout(resolve, 0))
      await waitForCompleteRender()

      expect(componentInstance.state.items[2].name).toBe('Last-Modified')
      expect(componentInstance.state.items[0].name).toBe('First')  // Not affected
      expect(componentInstance.state.items[1].name).toBe('Middle')  // Not affected

      // Verify checkbox model binding for middle item
      const middleCheckbox = items[1].querySelector('.item-active')
      expect(middleCheckbox.checked).toBe(true)
      middleCheckbox.checked = false
      middleCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
      // Same sequence: flush render, flush batch, flush re-render
      await waitForCompleteRender()
      await new Promise(resolve => setTimeout(resolve, 0))
      await waitForCompleteRender()

      expect(componentInstance.state.items[1].active).toBe(false)

      // Verify data-show updated for middle item
      expect(items[1].querySelector('.active-badge').style.display).toBe('none')
    })

    it('maintains bindings after insert in the middle of nested list', async () => {
      testContainer.innerHTML = `
        <div data-component="insert-middle-nested">
          <div data-list="groups">
            <template>
              <div class="group">
                <span class="group-name" data-bind="name"></span>
                <div data-list="members">
                  <template>
                    <div class="member">
                      <input type="text" class="member-input" data-model="name">
                      <span class="member-display" data-bind="name"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('insert-middle-nested', {
        state: {
          groups: [{
            id: 1,
            name: 'Team A',
            members: [
              { id: 101, name: 'Alice' },
              { id: 102, name: 'Charlie' }
            ]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      let members = testContainer.querySelectorAll('.member')
      expect(members.length).toBe(2)
      expect(members[0].querySelector('.member-display').textContent).toBe('Alice')
      expect(members[1].querySelector('.member-display').textContent).toBe('Charlie')

      // Insert Bob in the middle
      const group = componentInstance.state.groups[0]
      componentInstance.state.groups = [{
        ...group,
        members: [
          group.members[0],  // Alice
          { id: 103, name: 'Bob' },  // New middle member
          group.members[1]   // Charlie (now at index 2)
        ]
      }]

      await waitForCompleteRender()

      // Verify 3 members now
      members = testContainer.querySelectorAll('.member')
      expect(members.length).toBe(3)

      // Verify display bindings
      expect(members[0].querySelector('.member-display').textContent).toBe('Alice')
      expect(members[1].querySelector('.member-display').textContent).toBe('Bob')
      expect(members[2].querySelector('.member-display').textContent).toBe('Charlie')

      // Verify model binding for shifted Charlie (now at index 2)
      const charlieInput = members[2].querySelector('.member-input')
      charlieInput.value = 'Charles'
      charlieInput.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      expect(componentInstance.state.groups[0].members[2].name).toBe('Charles')
      expect(componentInstance.state.groups[0].members[0].name).toBe('Alice')  // Not affected
      expect(componentInstance.state.groups[0].members[1].name).toBe('Bob')    // Not affected

      // Verify model binding for new middle item (Bob)
      // Re-query members after previous state update - DOM may have been re-rendered
      const membersAfterCharlie = testContainer.querySelectorAll('.member')
      const bobInput = membersAfterCharlie[1].querySelector('.member-input')
      bobInput.value = 'Robert'
      bobInput.dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      expect(componentInstance.state.groups[0].members[1].name).toBe('Robert')
    })

    it('handles mixed insert and remove operations correctly', async () => {
      // Tests operations that change array length: remove then insert
      testContainer.innerHTML = `
        <div data-component="mixed-operations">
          <div data-list="items">
            <template>
              <div class="item">
                <input type="text" class="item-input" data-model="value">
                <span class="item-display" data-bind="value"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('mixed-operations', {
        state: {
          items: [
            { id: 1, value: 'A' },
            { id: 2, value: 'B' },
            { id: 3, value: 'C' },
            { id: 4, value: 'D' }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial: [A, B, C, D]
      expect(testContainer.querySelectorAll('.item').length).toBe(4)

      // Operation 1: Remove B (single removal, triggers _trySingleRemoval)
      // Result: [A, C, D]
      componentInstance.state.items = [
        componentInstance.state.items[0],  // A
        componentInstance.state.items[2],  // C
        componentInstance.state.items[3]   // D
      ]
      await waitForCompleteRender()

      let items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(3)
      expect(items[0].querySelector('.item-display').textContent).toBe('A')
      expect(items[1].querySelector('.item-display').textContent).toBe('C')
      expect(items[2].querySelector('.item-display').textContent).toBe('D')

      // Verify model bindings work after removal
      let inputs = testContainer.querySelectorAll('.item-input')
      inputs[1].value = 'C-modified'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[1].value).toBe('C-modified')

      // Operation 2: Insert X at beginning
      // Result: [X, A, C-modified, D]
      componentInstance.state.items = [
        { id: 5, value: 'X' },
        componentInstance.state.items[0],  // A
        componentInstance.state.items[1],  // C-modified
        componentInstance.state.items[2]   // D
      ]
      await waitForCompleteRender()

      items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(4)
      expect(items[0].querySelector('.item-display').textContent).toBe('X')
      expect(items[1].querySelector('.item-display').textContent).toBe('A')
      expect(items[2].querySelector('.item-display').textContent).toBe('C-modified')
      expect(items[3].querySelector('.item-display').textContent).toBe('D')

      // Verify model bindings work after insert
      inputs = testContainer.querySelectorAll('.item-input')

      // Modify D (now at index 3, was at index 2 before insert)
      inputs[3].value = 'D-modified'
      inputs[3].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[3].value).toBe('D-modified')

      // Modify X (new item at index 0)
      inputs[0].value = 'X-modified'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[0].value).toBe('X-modified')

      // Final state verification
      expect(componentInstance.state.items[0].value).toBe('X-modified')
      expect(componentInstance.state.items[1].value).toBe('A')
      expect(componentInstance.state.items[2].value).toBe('C-modified')
      expect(componentInstance.state.items[3].value).toBe('D-modified')
    })

    it('maintains nested list bindings after parent list insert', async () => {
      testContainer.innerHTML = `
        <div data-component="parent-insert-nested">
          <div data-list="teams">
            <template>
              <div class="team">
                <span class="team-name" data-bind="name"></span>
                <div data-list="players">
                  <template>
                    <div class="player">
                      <input type="text" class="player-input" data-model="name">
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('parent-insert-nested', {
        state: {
          teams: [
            { id: 1, name: 'Red Team', players: [{ id: 101, name: 'Player 1' }] },
            { id: 2, name: 'Blue Team', players: [{ id: 201, name: 'Player 2' }] }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial
      expect(testContainer.querySelectorAll('.team').length).toBe(2)
      expect(testContainer.querySelectorAll('.player').length).toBe(2)

      // Insert new team in the middle
      componentInstance.state.teams = [
        componentInstance.state.teams[0],
        { id: 3, name: 'Green Team', players: [{ id: 301, name: 'Player 3' }] },
        componentInstance.state.teams[1]  // Blue Team now at index 2
      ]

      await waitForCompleteRender()

      // Verify 3 teams, 3 players
      expect(testContainer.querySelectorAll('.team').length).toBe(3)
      expect(testContainer.querySelectorAll('.player').length).toBe(3)

      // Verify team names
      const teamNames = testContainer.querySelectorAll('.team-name')
      expect(teamNames[0].textContent).toBe('Red Team')
      expect(teamNames[1].textContent).toBe('Green Team')
      expect(teamNames[2].textContent).toBe('Blue Team')

      // Verify player model bindings work for the shifted Blue Team (now at index 2)
      const playerInputs = testContainer.querySelectorAll('.player-input')
      playerInputs[2].value = 'Player 2 Modified'
      playerInputs[2].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      expect(componentInstance.state.teams[2].players[0].name).toBe('Player 2 Modified')
      expect(componentInstance.state.teams[0].players[0].name).toBe('Player 1')  // Not affected
      expect(componentInstance.state.teams[1].players[0].name).toBe('Player 3')  // Not affected
    })

    // Non-consecutive bulk removal tests
    it('handles non-consecutive bulk removals (multi-select delete)', async () => {
      // Tests removing items from different parts of the list in one operation
      // Common scenario: user selects items A, F, J from a list and deletes them all
      testContainer.innerHTML = `
        <div data-component="bulk-removal-test">
          <div data-list="items">
            <template>
              <div class="item">
                <input type="text" class="item-input" data-model="name">
                <span class="item-display" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('bulk-removal-test', {
        state: {
          items: [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
            { id: 3, name: 'C' },
            { id: 4, name: 'D' },
            { id: 5, name: 'E' },
            { id: 6, name: 'F' },
            { id: 7, name: 'G' },
            { id: 8, name: 'H' },
            { id: 9, name: 'I' },
            { id: 10, name: 'J' }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      expect(testContainer.querySelectorAll('.item').length).toBe(10)

      // Remove items at indices 0, 5, 9 (A, F, J) - non-consecutive removal
      // Remaining should be: B, C, D, E, G, H, I
      componentInstance.state.items = componentInstance.state.items.filter(item =>
        item.name !== 'A' && item.name !== 'F' && item.name !== 'J'
      )

      await waitForCompleteRender()

      // Verify 7 items remain
      const items = testContainer.querySelectorAll('.item')
      expect(items.length).toBe(7)

      // Verify correct items remain in correct order
      const expectedNames = ['B', 'C', 'D', 'E', 'G', 'H', 'I']
      for (let i = 0; i < expectedNames.length; i++) {
        expect(items[i].querySelector('.item-display').textContent).toBe(expectedNames[i])
      }

      // Verify model bindings work for shifted items
      const inputs = testContainer.querySelectorAll('.item-input')

      // Modify G (was at index 6, now at index 4)
      inputs[4].value = 'G-modified'
      inputs[4].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[4].name).toBe('G-modified')

      // Modify B (was at index 1, now at index 0)
      inputs[0].value = 'B-modified'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[0].name).toBe('B-modified')

      // Modify I (was at index 8, now at index 6 - last item)
      inputs[6].value = 'I-modified'
      inputs[6].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[6].name).toBe('I-modified')

      // Verify other items weren't affected
      expect(componentInstance.state.items[1].name).toBe('C')
      expect(componentInstance.state.items[2].name).toBe('D')
      expect(componentInstance.state.items[3].name).toBe('E')
      expect(componentInstance.state.items[5].name).toBe('H')
    })

    it('handles non-consecutive bulk removals in nested list', async () => {
      // Tests removing non-adjacent items from a nested list
      testContainer.innerHTML = `
        <div data-component="nested-bulk-removal-test">
          <div data-list="groups">
            <template>
              <div class="group">
                <span class="group-name" data-bind="name"></span>
                <div data-list="members">
                  <template>
                    <div class="member">
                      <input type="text" class="member-input" data-model="name">
                      <span class="member-display" data-bind="name"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-bulk-removal-test', {
        state: {
          groups: [{
            id: 1,
            name: 'Team Alpha',
            members: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' },
              { id: 3, name: 'Charlie' },
              { id: 4, name: 'Diana' },
              { id: 5, name: 'Eve' },
              { id: 6, name: 'Frank' }
            ]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial state
      expect(testContainer.querySelectorAll('.member').length).toBe(6)

      // Remove Alice (0), Charlie (2), Frank (5) - non-consecutive
      // Remaining: Bob, Diana, Eve
      const group = componentInstance.state.groups[0]
      componentInstance.state.groups = [{
        ...group,
        members: group.members.filter(m =>
          m.name !== 'Alice' && m.name !== 'Charlie' && m.name !== 'Frank'
        )
      }]

      await waitForCompleteRender()

      // Verify 3 members remain
      const members = testContainer.querySelectorAll('.member')
      expect(members.length).toBe(3)

      // Verify correct members remain
      expect(members[0].querySelector('.member-display').textContent).toBe('Bob')
      expect(members[1].querySelector('.member-display').textContent).toBe('Diana')
      expect(members[2].querySelector('.member-display').textContent).toBe('Eve')

      // Verify model bindings work for all remaining members
      const inputs = testContainer.querySelectorAll('.member-input')

      // Modify Bob (was at 1, now at 0)
      inputs[0].value = 'Robert'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.groups[0].members[0].name).toBe('Robert')

      // Modify Diana (was at 3, now at 1)
      inputs[1].value = 'Di'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.groups[0].members[1].name).toBe('Di')

      // Modify Eve (was at 4, now at 2)
      inputs[2].value = 'Evelyn'
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.groups[0].members[2].name).toBe('Evelyn')
    })

    it('handles sort operation on top-level list', async () => {
      // Tests sorting a list - very common operation (sort by name, priority, date, etc.)
      testContainer.innerHTML = `
        <div data-component="sort-test">
          <div data-list="items">
            <template>
              <div class="item">
                <input type="text" class="item-input" data-model="name">
                <span class="item-display" data-bind="name"></span>
                <span class="item-priority" data-bind="priority"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('sort-test', {
        state: {
          items: [
            { id: 1, name: 'Zebra', priority: 3 },
            { id: 2, name: 'Apple', priority: 1 },
            { id: 3, name: 'Mango', priority: 2 },
            { id: 4, name: 'Banana', priority: 4 }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial order
      let displays = testContainer.querySelectorAll('.item-display')
      expect(displays[0].textContent).toBe('Zebra')
      expect(displays[1].textContent).toBe('Apple')
      expect(displays[2].textContent).toBe('Mango')
      expect(displays[3].textContent).toBe('Banana')

      // Sort alphabetically by name
      componentInstance.state.items = [...componentInstance.state.items].sort((a, b) =>
        a.name.localeCompare(b.name)
      )

      await waitForCompleteRender()

      // Verify sorted order
      displays = testContainer.querySelectorAll('.item-display')
      expect(displays[0].textContent).toBe('Apple')
      expect(displays[1].textContent).toBe('Banana')
      expect(displays[2].textContent).toBe('Mango')
      expect(displays[3].textContent).toBe('Zebra')

      // Verify model bindings work after sort
      const inputs = testContainer.querySelectorAll('.item-input')

      // Modify Apple (was at index 1, now at index 0)
      inputs[0].value = 'Apricot'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[0].name).toBe('Apricot')

      // Modify Zebra (was at index 0, now at index 3)
      inputs[3].value = 'Zucchini'
      inputs[3].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[3].name).toBe('Zucchini')

      // Verify middle items still work
      inputs[1].value = 'Blueberry'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[1].name).toBe('Blueberry')
    })

    it('handles reverse operation on nested list', async () => {
      // Tests reversing a nested list
      testContainer.innerHTML = `
        <div data-component="reverse-nested-test">
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
      wildflower.component('reverse-nested-test', {
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

      // Verify initial order
      let displays = testContainer.querySelectorAll('.task-display')
      expect(displays[0].textContent).toBe('First')
      expect(displays[1].textContent).toBe('Second')
      expect(displays[2].textContent).toBe('Third')
      expect(displays[3].textContent).toBe('Fourth')

      // Reverse the nested list
      const group = componentInstance.state.groups[0]
      componentInstance.state.groups = [{
        ...group,
        tasks: [...group.tasks].reverse()
      }]

      await waitForCompleteRender()

      // Verify reversed order
      displays = testContainer.querySelectorAll('.task-display')
      expect(displays[0].textContent).toBe('Fourth')
      expect(displays[1].textContent).toBe('Third')
      expect(displays[2].textContent).toBe('Second')
      expect(displays[3].textContent).toBe('First')

      // Verify model bindings work after reverse
      const inputs = testContainer.querySelectorAll('.task-input')

      // Modify Fourth (was at index 3, now at index 0)
      inputs[0].value = 'Fourth-modified'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.groups[0].tasks[0].title).toBe('Fourth-modified')

      // Modify First (was at index 0, now at index 3)
      inputs[3].value = 'First-modified'
      inputs[3].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.groups[0].tasks[3].title).toBe('First-modified')
    })

    it('handles sort operation on nested list', async () => {
      // Tests sorting within a nested list (e.g., sort tasks by priority)
      testContainer.innerHTML = `
        <div data-component="sort-nested-test">
          <div data-list="projects">
            <template>
              <div class="project">
                <span class="project-name" data-bind="name"></span>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <input type="text" class="task-input" data-model="title">
                      <span class="task-display" data-bind="title"></span>
                      <span class="task-priority" data-bind="priority"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('sort-nested-test', {
        state: {
          projects: [{
            id: 1,
            name: 'Main Project',
            tasks: [
              { id: 1, title: 'Low priority', priority: 3 },
              { id: 2, title: 'High priority', priority: 1 },
              { id: 3, title: 'Medium priority', priority: 2 }
            ]
          }]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Verify initial order
      let displays = testContainer.querySelectorAll('.task-display')
      expect(displays[0].textContent).toBe('Low priority')
      expect(displays[1].textContent).toBe('High priority')
      expect(displays[2].textContent).toBe('Medium priority')

      // Sort by priority (ascending)
      const project = componentInstance.state.projects[0]
      componentInstance.state.projects = [{
        ...project,
        tasks: [...project.tasks].sort((a, b) => a.priority - b.priority)
      }]

      await waitForCompleteRender()

      // Verify sorted order
      displays = testContainer.querySelectorAll('.task-display')
      expect(displays[0].textContent).toBe('High priority')
      expect(displays[1].textContent).toBe('Medium priority')
      expect(displays[2].textContent).toBe('Low priority')

      // Verify model bindings work after sort
      const inputs = testContainer.querySelectorAll('.task-input')

      // Modify High priority (was at index 1, now at index 0)
      inputs[0].value = 'Urgent'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.projects[0].tasks[0].title).toBe('Urgent')

      // Modify Low priority (was at index 0, now at index 2)
      inputs[2].value = 'Backlog'
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.projects[0].tasks[2].title).toBe('Backlog')
    })

    it('handles nested list with external state', async () => {
      // Tests nested lists fed by store state - common pattern for shared data
      testContainer.innerHTML = `
        <div data-component="external-nested-consumer">
          <div data-list="categories">
            <template>
              <div class="category">
                <span class="category-name" data-bind="name"></span>
                <div data-list="items">
                  <template>
                    <div class="item">
                      <input type="text" class="item-input" data-model="name">
                      <span class="item-display" data-bind="name"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let consumerInstance
      wildflower.store('external-data-store', {
        state: {
          categories: [
            {
              id: 1,
              name: 'Fruits',
              items: [
                { id: 1, name: 'Apple' },
                { id: 2, name: 'Banana' }
              ]
            },
            {
              id: 2,
              name: 'Vegetables',
              items: [
                { id: 3, name: 'Carrot' },
                { id: 4, name: 'Potato' }
              ]
            }
          ]
        }
      })

      wildflower.component('external-nested-consumer', {
        subscribe: { 'external-data-store': ['categories'] },
        state: {
          categories: []
        },
        init() {
          consumerInstance = this
          // Get data from store
          this.state.categories = this.stores['external-data-store'].categories
        }
      })

      await waitForCompleteRender()

      // Verify initial render from external data
      let categories = testContainer.querySelectorAll('.category')
      expect(categories.length).toBe(2)

      expect(categories[0].querySelector('.category-name').textContent).toBe('Fruits')
      expect(categories[1].querySelector('.category-name').textContent).toBe('Vegetables')

      let fruitItems = categories[0].querySelectorAll('.item-display')
      expect(fruitItems[0].textContent).toBe('Apple')
      expect(fruitItems[1].textContent).toBe('Banana')

      let vegItems = categories[1].querySelectorAll('.item-display')
      expect(vegItems[0].textContent).toBe('Carrot')
      expect(vegItems[1].textContent).toBe('Potato')

      // Verify model bindings work on external-fed nested list
      let inputs = categories[0].querySelectorAll('.item-input')
      inputs[0].value = 'Apricot'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()

      // The consumer's state should update
      expect(consumerInstance.state.categories[0].items[0].name).toBe('Apricot')

      // Modify nested item in second category
      inputs = testContainer.querySelectorAll('.category')[1].querySelectorAll('.item-input')
      inputs[1].value = 'Sweet Potato'
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(consumerInstance.state.categories[1].items[1].name).toBe('Sweet Potato')

      // Test add to nested list (consumer modifies its own copy)
      consumerInstance.state.categories = [
        {
          ...consumerInstance.state.categories[0],
          items: [
            ...consumerInstance.state.categories[0].items,
            { id: 5, name: 'Cherry' }
          ]
        },
        consumerInstance.state.categories[1]
      ]

      await waitForCompleteRender()

      // Verify the add worked
      fruitItems = testContainer.querySelectorAll('.category')[0].querySelectorAll('.item-display')
      expect(fruitItems.length).toBe(3)
      expect(fruitItems[2].textContent).toBe('Cherry')

      // Verify model binding works on newly added item
      inputs = testContainer.querySelectorAll('.category')[0].querySelectorAll('.item-input')
      inputs[2].value = 'Cherries'
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(consumerInstance.state.categories[0].items[2].name).toBe('Cherries')
    })

    it('handles multiple sort operations in sequence', async () => {
      // Tests multiple sorts back-to-back (common: sort by name, then by date, then by priority)
      testContainer.innerHTML = `
        <div data-component="multi-sort-test">
          <div data-list="items">
            <template>
              <div class="item">
                <input type="text" class="item-input" data-model="name">
                <span class="item-display" data-bind="name"></span>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('multi-sort-test', {
        state: {
          items: [
            { id: 1, name: 'Delta', priority: 2 },
            { id: 2, name: 'Alpha', priority: 4 },
            { id: 3, name: 'Charlie', priority: 1 },
            { id: 4, name: 'Bravo', priority: 3 }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Sort alphabetically
      componentInstance.state.items = [...componentInstance.state.items].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
      await waitForCompleteRender()

      let displays = testContainer.querySelectorAll('.item-display')
      expect(displays[0].textContent).toBe('Alpha')
      expect(displays[1].textContent).toBe('Bravo')
      expect(displays[2].textContent).toBe('Charlie')
      expect(displays[3].textContent).toBe('Delta')

      // Now sort by priority
      componentInstance.state.items = [...componentInstance.state.items].sort((a, b) =>
        a.priority - b.priority
      )
      await waitForCompleteRender()

      displays = testContainer.querySelectorAll('.item-display')
      expect(displays[0].textContent).toBe('Charlie')  // priority 1
      expect(displays[1].textContent).toBe('Delta')    // priority 2
      expect(displays[2].textContent).toBe('Bravo')    // priority 3
      expect(displays[3].textContent).toBe('Alpha')    // priority 4

      // Reverse the list
      componentInstance.state.items = [...componentInstance.state.items].reverse()
      await waitForCompleteRender()

      displays = testContainer.querySelectorAll('.item-display')
      expect(displays[0].textContent).toBe('Alpha')
      expect(displays[1].textContent).toBe('Bravo')
      expect(displays[2].textContent).toBe('Delta')
      expect(displays[3].textContent).toBe('Charlie')

      // Verify model bindings still work after multiple reorders
      const inputs = testContainer.querySelectorAll('.item-input')

      inputs[0].value = 'Alpha-modified'
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[0].name).toBe('Alpha-modified')

      inputs[3].value = 'Charlie-modified'
      inputs[3].dispatchEvent(new Event('input', { bubbles: true }))
      await waitForUpdate()
      expect(componentInstance.state.items[3].name).toBe('Charlie-modified')
    })
  })

  // ============================================================
  // FOCUSED INPUT NESTED LIST ISOLATION
  // Regression test for checkbox/input focus corruption bug
  // ============================================================

  describe('Focused Input Nested List Isolation', () => {

    it('checkbox in nested list does not corrupt sibling parent task names', async () => {
      // This test covers the bug where clicking a checkbox in Project Beta's tasks
      // would corrupt Project Alpha's task names with project names.
      // Root cause: _tryFocusedInputUpdate was using querySelector('[data-index="1"]')
      // which found nested list items before direct children, and wasn't filtering
      // bind elements inside nested lists.
      testContainer.innerHTML = `
        <div data-component="nested-checkbox-isolation">
          <div data-list="projects">
            <template>
              <div class="project">
                <h3 class="project-name" data-bind="name"></h3>
                <div data-list="tasks">
                  <template>
                    <div class="task">
                      <input type="checkbox" class="task-checkbox" data-model="completed">
                      <span class="task-name" data-bind="name"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-checkbox-isolation', {
        state: {
          projects: [
            {
              id: 1,
              name: 'Project Alpha',
              tasks: [
                { id: 1, name: 'Task A1', completed: false },
                { id: 2, name: 'Task A2', completed: false }
              ]
            },
            {
              id: 2,
              name: 'Project Beta',
              tasks: [
                { id: 3, name: 'Task B1', completed: false },
                { id: 4, name: 'Task B2', completed: false }
              ]
            }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Capture initial state of all task names
      const getTaskNames = () => {
        const names = []
        const projects = testContainer.querySelectorAll('[data-list="projects"] > :not(template)')
        projects.forEach((project, pIdx) => {
          const tasks = project.querySelectorAll('[data-list="tasks"] > :not(template)')
          tasks.forEach((task, tIdx) => {
            names.push({
              project: pIdx,
              task: tIdx,
              name: task.querySelector('.task-name').textContent
            })
          })
        })
        return names
      }

      // Verify initial state
      const initialNames = getTaskNames()
      expect(initialNames).toEqual([
        { project: 0, task: 0, name: 'Task A1' },
        { project: 0, task: 1, name: 'Task A2' },
        { project: 1, task: 0, name: 'Task B1' },
        { project: 1, task: 1, name: 'Task B2' }
      ])

      // Click checkbox for Task B1 (Project Beta's first task)
      const projects = testContainer.querySelectorAll('[data-list="projects"] > :not(template)')
      const projectBetaTasks = projects[1].querySelectorAll('[data-list="tasks"] > :not(template)')
      const taskB1Checkbox = projectBetaTasks[0].querySelector('.task-checkbox')

      taskB1Checkbox.checked = true
      taskB1Checkbox.dispatchEvent(new Event('change', { bubbles: true }))

      await waitForCompleteRender()

      // CRITICAL: Verify Project Alpha's task names were NOT corrupted
      const afterClickNames = getTaskNames()
      expect(afterClickNames).toEqual([
        { project: 0, task: 0, name: 'Task A1' },  // Should NOT become 'Project Alpha'
        { project: 0, task: 1, name: 'Task A2' },  // Should NOT become 'Project Beta'
        { project: 1, task: 0, name: 'Task B1' },
        { project: 1, task: 1, name: 'Task B2' }
      ])

      // Also verify the checkbox state was updated correctly
      expect(componentInstance.state.projects[1].tasks[0].completed).toBe(true)

      // Verify project names are also still correct
      const projectNames = testContainer.querySelectorAll('.project-name')
      expect(projectNames[0].textContent).toBe('Project Alpha')
      expect(projectNames[1].textContent).toBe('Project Beta')
    })

    it('text input in nested list does not corrupt sibling parent names', async () => {
      // Similar test but with text input instead of checkbox
      testContainer.innerHTML = `
        <div data-component="nested-input-isolation">
          <div data-list="categories">
            <template>
              <div class="category">
                <h3 class="category-name" data-bind="name"></h3>
                <div data-list="items">
                  <template>
                    <div class="item">
                      <input type="text" class="item-input" data-model="name">
                      <span class="item-display" data-bind="name"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-input-isolation', {
        state: {
          categories: [
            {
              id: 1,
              name: 'Category One',
              items: [
                { id: 1, name: 'Item 1A' },
                { id: 2, name: 'Item 1B' }
              ]
            },
            {
              id: 2,
              name: 'Category Two',
              items: [
                { id: 3, name: 'Item 2A' },
                { id: 4, name: 'Item 2B' }
              ]
            }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Get all item displays
      const getItemDisplays = () => {
        const displays = []
        const categories = testContainer.querySelectorAll('[data-list="categories"] > :not(template)')
        categories.forEach((cat, cIdx) => {
          const items = cat.querySelectorAll('[data-list="items"] > :not(template)')
          items.forEach((item, iIdx) => {
            displays.push({
              category: cIdx,
              item: iIdx,
              name: item.querySelector('.item-display').textContent
            })
          })
        })
        return displays
      }

      // Verify initial state
      expect(getItemDisplays()).toEqual([
        { category: 0, item: 0, name: 'Item 1A' },
        { category: 0, item: 1, name: 'Item 1B' },
        { category: 1, item: 0, name: 'Item 2A' },
        { category: 1, item: 1, name: 'Item 2B' }
      ])

      // Type in input for Item 2A (Category Two's first item)
      const categories = testContainer.querySelectorAll('[data-list="categories"] > :not(template)')
      const cat2Items = categories[1].querySelectorAll('[data-list="items"] > :not(template)')
      const item2AInput = cat2Items[0].querySelector('.item-input')

      item2AInput.focus()
      item2AInput.value = 'Modified 2A'
      item2AInput.dispatchEvent(new Event('input', { bubbles: true }))

      await waitForCompleteRender()

      // CRITICAL: Verify Category One's item names were NOT corrupted
      const afterInputDisplays = getItemDisplays()
      expect(afterInputDisplays[0].name).toBe('Item 1A')  // Should NOT become 'Category One'
      expect(afterInputDisplays[1].name).toBe('Item 1B')  // Should NOT become 'Category Two'
      expect(afterInputDisplays[2].name).toBe('Modified 2A')  // This one changed
      expect(afterInputDisplays[3].name).toBe('Item 2B')

      // Verify category names are also still correct
      const categoryNames = testContainer.querySelectorAll('.category-name')
      expect(categoryNames[0].textContent).toBe('Category One')
      expect(categoryNames[1].textContent).toBe('Category Two')
    })

    it('multiple checkbox toggles across different parents maintain isolation', async () => {
      // Test rapid checkbox interactions across multiple parents
      testContainer.innerHTML = `
        <div data-component="nested-multi-checkbox">
          <div data-list="groups">
            <template>
              <div class="group">
                <span class="group-title" data-bind="title"></span>
                <div data-list="todos">
                  <template>
                    <div class="todo">
                      <input type="checkbox" class="todo-done" data-model="done">
                      <span class="todo-text" data-bind="text"></span>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      `

      let componentInstance
      wildflower.component('nested-multi-checkbox', {
        state: {
          groups: [
            {
              id: 1,
              title: 'Work',
              todos: [
                { id: 1, text: 'Meeting', done: false },
                { id: 2, text: 'Report', done: false }
              ]
            },
            {
              id: 2,
              title: 'Home',
              todos: [
                { id: 3, text: 'Groceries', done: false },
                { id: 4, text: 'Laundry', done: false }
              ]
            },
            {
              id: 3,
              title: 'Personal',
              todos: [
                { id: 5, text: 'Exercise', done: false },
                { id: 6, text: 'Reading', done: false }
              ]
            }
          ]
        },
        init() {
          componentInstance = this
        }
      })

      await waitForCompleteRender()

      // Helper to get all todo texts
      const getTodoTexts = () => {
        const texts = []
        const groups = testContainer.querySelectorAll('[data-list="groups"] > :not(template)')
        groups.forEach(group => {
          const todos = group.querySelectorAll('[data-list="todos"] > :not(template)')
          todos.forEach(todo => {
            texts.push(todo.querySelector('.todo-text').textContent)
          })
        })
        return texts
      }

      // Initial state
      expect(getTodoTexts()).toEqual([
        'Meeting', 'Report', 'Groceries', 'Laundry', 'Exercise', 'Reading'
      ])

      // Toggle checkboxes in different groups rapidly
      const groups = testContainer.querySelectorAll('[data-list="groups"] > :not(template)')

      // Toggle "Report" in Work group
      const workTodos = groups[0].querySelectorAll('[data-list="todos"] > :not(template)')
      const reportCheckbox = workTodos[1].querySelector('.todo-done')
      reportCheckbox.checked = true
      reportCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForUpdate()

      // Toggle "Groceries" in Home group
      const homeTodos = groups[1].querySelectorAll('[data-list="todos"] > :not(template)')
      const groceriesCheckbox = homeTodos[0].querySelector('.todo-done')
      groceriesCheckbox.checked = true
      groceriesCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForUpdate()

      // Toggle "Reading" in Personal group
      const personalTodos = groups[2].querySelectorAll('[data-list="todos"] > :not(template)')
      const readingCheckbox = personalTodos[1].querySelector('.todo-done')
      readingCheckbox.checked = true
      readingCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
      await waitForCompleteRender()

      // CRITICAL: All todo texts should remain unchanged
      expect(getTodoTexts()).toEqual([
        'Meeting', 'Report', 'Groceries', 'Laundry', 'Exercise', 'Reading'
      ])

      // Verify state was updated correctly
      expect(componentInstance.state.groups[0].todos[1].done).toBe(true)  // Report
      expect(componentInstance.state.groups[1].todos[0].done).toBe(true)  // Groceries
      expect(componentInstance.state.groups[2].todos[1].done).toBe(true)  // Reading

      // Group titles should also be unchanged
      const groupTitles = testContainer.querySelectorAll('.group-title')
      expect(groupTitles[0].textContent).toBe('Work')
      expect(groupTitles[1].textContent).toBe('Home')
      expect(groupTitles[2].textContent).toBe('Personal')
    })
  })
})
