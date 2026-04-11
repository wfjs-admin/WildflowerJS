/**
 * Tests for rebindActions() method
 *
 * rebindActions() allows components to bind action handlers for
 * dynamically added content (e.g., after innerHTML updates).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadFramework, resetFramework } from './helpers/load-framework.js';

// Helper to wait for framework render cycle
async function waitForUpdate(ms = 50) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

describe('rebindActions()', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
    });

    beforeEach(() => {
        // Get framework reference
        wildflower = window.wildflower;

        // Clear framework state
        if (wildflower.componentDefinitions) {
            wildflower.componentDefinitions.clear();
        }
        if (wildflower.componentInstances) {
            wildflower.componentInstances.clear();
        }

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        // Clean up
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
        // Reset framework state
        if (wildflower) {
            wildflower.componentInstances.clear();
            wildflower.componentDefinitions.clear();
        }
    });

    it('should bind actions for dynamically added elements', async () => {
        let clickCount = 0;

        wildflower.component('rebind-test', {
            state: {},
            handleClick() {
                clickCount++;
            },
            addButton() {
                // Dynamically add a button with data-action
                const container = this.element.querySelector('.dynamic-content');
                container.innerHTML = '<button data-action="handleClick">Click Me</button>';
                this.rebindActions();
            },
            init() {
                // Add button after a small delay to simulate dynamic content
                setTimeout(() => this.addButton(), 10);
            }
        });

        testContainer.innerHTML = `
            <div data-component="rebind-test">
                <div class="dynamic-content"></div>
            </div>
        `;

        wildflower.scan(testContainer);

        // Wait for component init and dynamic content
        await new Promise(resolve => setTimeout(resolve, 50));

        // Find and click the button
        const button = testContainer.querySelector('button[data-action="handleClick"]');
        expect(button).not.toBeNull();

        button.click();
        expect(clickCount).toBe(1);

        button.click();
        expect(clickCount).toBe(2);
    });

    it('should not rebind already-bound elements', async () => {
        let clickCount = 0;

        wildflower.component('rebind-idempotent-test', {
            state: {},
            handleClick() {
                clickCount++;
            },
            init() {
                // Call rebindActions multiple times - should not cause multiple bindings
                this.rebindActions();
                this.rebindActions();
                this.rebindActions();
            }
        });

        testContainer.innerHTML = `
            <div data-component="rebind-idempotent-test">
                <button data-action="handleClick">Click Me</button>
            </div>
        `;

        wildflower.scan(testContainer);
        await new Promise(resolve => setTimeout(resolve, 20));

        const button = testContainer.querySelector('button');
        button.click();

        // Should only fire once despite multiple rebindActions calls
        expect(clickCount).toBe(1);
    });

    it('should work with multiple dynamic updates', async () => {
        const clicks = [];

        wildflower.component('rebind-multiple-test', {
            state: { buttonCount: 0 },
            handleClick(event, element) {
                clicks.push(element.textContent);
            },
            addButtons(count) {
                const container = this.element.querySelector('.buttons');
                let html = '';
                for (let i = 1; i <= count; i++) {
                    html += `<button data-action="handleClick">Button ${i}</button>`;
                }
                container.innerHTML = html;
                this.rebindActions();
            }
        });

        testContainer.innerHTML = `
            <div data-component="rebind-multiple-test">
                <div class="buttons"></div>
            </div>
        `;

        wildflower.scan(testContainer);
        await new Promise(resolve => setTimeout(resolve, 20));

        const component = wildflower.getComponentsByType('rebind-multiple-test')[0];

        // First update
        component.context.addButtons(2);
        await new Promise(resolve => setTimeout(resolve, 10));

        let buttons = testContainer.querySelectorAll('button');
        expect(buttons.length).toBe(2);
        buttons[0].click();
        buttons[1].click();
        expect(clicks).toEqual(['Button 1', 'Button 2']);

        // Second update - replace content
        clicks.length = 0;
        component.context.addButtons(3);
        await new Promise(resolve => setTimeout(resolve, 10));

        buttons = testContainer.querySelectorAll('button');
        expect(buttons.length).toBe(3);
        buttons[0].click();
        buttons[2].click();
        expect(clicks).toEqual(['Button 1', 'Button 3']);
    });

    it('should pass event and element to action handler', async () => {
        let receivedEvent = null;
        let receivedElement = null;

        wildflower.component('rebind-params-test', {
            state: {},
            handleAction(event, element) {
                receivedEvent = event;
                receivedElement = element;
            },
            addContent() {
                this.element.querySelector('.content').innerHTML =
                    '<span data-action="handleAction" class="clickable">Click Target</span>';
                this.rebindActions();
            }
        });

        testContainer.innerHTML = `
            <div data-component="rebind-params-test">
                <div class="content"></div>
            </div>
        `;

        wildflower.scan(testContainer);
        await new Promise(resolve => setTimeout(resolve, 20));

        const component = wildflower.getComponentsByType('rebind-params-test')[0];
        component.context.addContent();
        await new Promise(resolve => setTimeout(resolve, 10));

        const target = testContainer.querySelector('.clickable');
        target.click();

        expect(receivedEvent).not.toBeNull();
        expect(receivedEvent.type).toBe('click');
        expect(receivedElement).toBe(target);
    });

    it('should work with different event types', async () => {
        let mouseEnterCount = 0;

        wildflower.component('rebind-events-test', {
            state: {},
            events: {
                mouseenter: 'mouseenter'
            },
            handleHover() {
                mouseEnterCount++;
            },
            addContent() {
                this.element.querySelector('.content').innerHTML =
                    '<div data-action="mouseenter:handleHover" class="hover-target">Hover Me</div>';
                this.rebindActions();
            }
        });

        testContainer.innerHTML = `
            <div data-component="rebind-events-test">
                <div class="content"></div>
            </div>
        `;

        wildflower.scan(testContainer);
        await new Promise(resolve => setTimeout(resolve, 20));

        const component = wildflower.getComponentsByType('rebind-events-test')[0];
        component.context.addContent();
        await new Promise(resolve => setTimeout(resolve, 10));

        const target = testContainer.querySelector('.hover-target');
        const mouseEnterEvent = new MouseEvent('mouseenter', { bubbles: true });
        target.dispatchEvent(mouseEnterEvent);

        expect(mouseEnterCount).toBe(1);
    });
});
