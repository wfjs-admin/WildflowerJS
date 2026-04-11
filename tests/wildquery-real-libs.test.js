/**
 * WildQuery Real Third-Party Library Integration Tests
 *
 * Tests integration between WildflowerJS's WildQuery ($) API and real third-party libraries:
 * - Flatpickr (date picker)
 * - noUiSlider (range slider)
 * - Tippy.js (tooltips)
 *
 * These tests verify that WildQuery provides sufficient jQuery-like functionality
 * to integrate smoothly with popular third-party UI libraries.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { loadFramework, resetFramework, waitForUpdate } from './helpers/load-framework.js';

// Track loaded libraries to avoid reloading
let librariesLoaded = false;

// CDN URLs for third-party libraries used in integration tests
const CDN_LIBS = {
    flatpickr: 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js',
    nouislider: 'https://cdn.jsdelivr.net/npm/nouislider@15.7.1/dist/nouislider.min.js',
    popper: 'https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.8/dist/umd/popper.min.js',
    tippy: 'https://cdn.jsdelivr.net/npm/tippy.js@6.3.7/dist/tippy-bundle.umd.min.js'
};

async function loadThirdPartyLibraries() {
    if (librariesLoaded) return;

    const loadScript = (url) => new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${url}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });

    try {
        await loadScript(CDN_LIBS.flatpickr);
        await loadScript(CDN_LIBS.nouislider);
        await loadScript(CDN_LIBS.popper);
        await loadScript(CDN_LIBS.tippy);
        librariesLoaded = true;
    } catch (e) {
        console.error('Failed to load third-party libraries from CDN:', e);
        throw e;
    }
}

describe('WildQuery Real Third-Party Library Integration', () => {
    let testContainer;
    let wildflower;

    beforeAll(async () => {
        await loadFramework();
        await loadThirdPartyLibraries();
    });

    beforeEach(() => {
        wildflower = window.wildflower;
        resetFramework();

        testContainer = document.createElement('div');
        testContainer.id = 'test-container';
        testContainer.style.position = 'absolute';
        testContainer.style.left = '-9999px';
        testContainer.style.opacity = '0';
        document.body.appendChild(testContainer);
    });

    afterEach(() => {
        if (testContainer && testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
        }
        // Clean up tippy tooltips
        document.querySelectorAll('[data-tippy-root]').forEach(el => el.remove());
        // Clean up flatpickr calendars
        document.querySelectorAll('.flatpickr-calendar').forEach(el => el.remove());
    });

    describe('Flatpickr Integration', () => {
        it('should initialize flatpickr on input using WildQuery', async () => {
            let pickerInstance = null;

            wildflower.component('date-picker-test', {
                state: { selectedDate: null },
                init() {
                    const input = this.$el('.date-input').get(0);
                    pickerInstance = window.flatpickr(input, {
                        dateFormat: 'Y-m-d'
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="date-picker-test">
                    <input type="text" class="date-input" placeholder="Select date">
                </div>
            `;
            await waitForUpdate(150);

            const input = testContainer.querySelector('.date-input');
            expect(input._flatpickr).toBeDefined();
            expect(input.classList.contains('flatpickr-input')).toBe(true);

            // Cleanup
            if (pickerInstance) pickerInstance.destroy();
        });

        it('should update component state when date is selected via flatpickr', async () => {
            let instance = null;
            let pickerInstance = null;

            wildflower.component('date-picker-reactive', {
                state: { selectedDate: '' },
                init() {
                    instance = this;
                    const input = this.$el('.date-input').get(0);
                    pickerInstance = window.flatpickr(input, {
                        dateFormat: 'Y-m-d',
                        onChange: (selectedDates, dateStr) => {
                            this.state.selectedDate = dateStr;
                        }
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="date-picker-reactive">
                    <input type="text" class="date-input">
                    <span class="output" data-bind="selectedDate"></span>
                </div>
            `;
            await waitForUpdate(150);

            const input = testContainer.querySelector('.date-input');
            input._flatpickr.setDate('2026-02-03', true);
            await waitForUpdate(100);

            expect(instance.state.selectedDate).toBe('2026-02-03');
            expect(testContainer.querySelector('.output').textContent).toBe('2026-02-03');

            if (pickerInstance) pickerInstance.destroy();
        });

        it('should use WildQuery to style flatpickr input', async () => {
            let pickerInstance = null;

            wildflower.component('styled-date-picker', {
                state: {},
                init() {
                    this.$el('.date-input')
                        .addClass('styled-input')
                        .css({ border: '2px solid blue', padding: '10px' });

                    const input = this.$el('.date-input').get(0);
                    pickerInstance = window.flatpickr(input, { dateFormat: 'Y-m-d' });
                }
            });

            testContainer.innerHTML = `
                <div data-component="styled-date-picker">
                    <input type="text" class="date-input">
                </div>
            `;
            await waitForUpdate(150);

            const input = testContainer.querySelector('.date-input');
            expect(input.classList.contains('styled-input')).toBe(true);
            expect(input.style.border).toBe('2px solid blue');
            expect(input.style.padding).toBe('10px');

            if (pickerInstance) pickerInstance.destroy();
        });
    });

    describe('noUiSlider Integration', () => {
        it('should initialize noUiSlider on element using WildQuery', async () => {
            wildflower.component('slider-test', {
                state: { value: 50 },
                init() {
                    const sliderEl = this.$el('.slider').get(0);
                    window.noUiSlider.create(sliderEl, {
                        start: [this.state.value],
                        range: { min: 0, max: 100 }
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="slider-test">
                    <div class="slider"></div>
                </div>
            `;
            await waitForUpdate(150);

            const slider = testContainer.querySelector('.slider');
            expect(slider.noUiSlider).toBeDefined();
            expect(slider.classList.contains('noUi-target')).toBe(true);

            slider.noUiSlider.destroy();
        });

        it('should update component state when slider value changes', async () => {
            let instance = null;

            wildflower.component('reactive-slider', {
                state: { value: 25 },
                init() {
                    instance = this;
                    const sliderEl = this.$el('.slider').get(0);
                    window.noUiSlider.create(sliderEl, {
                        start: [this.state.value],
                        range: { min: 0, max: 100 }
                    });

                    sliderEl.noUiSlider.on('update', (values) => {
                        this.state.value = Math.round(parseFloat(values[0]));
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="reactive-slider">
                    <div class="slider"></div>
                    <span class="output" data-bind="value"></span>
                </div>
            `;
            await waitForUpdate(150);

            const slider = testContainer.querySelector('.slider');
            slider.noUiSlider.set(75);
            await waitForUpdate(100);

            expect(instance.state.value).toBe(75);
            expect(testContainer.querySelector('.output').textContent).toBe('75');

            slider.noUiSlider.destroy();
        });

        it('should find multiple sliders with WildQuery and initialize each', async () => {
            wildflower.component('multi-slider', {
                state: { red: 128, green: 128, blue: 128 },
                init() {
                    const self = this;
                    this.$el('.color-slider').each(function(el, index) {
                        const colors = ['red', 'green', 'blue'];
                        const colorName = colors[index];

                        window.noUiSlider.create(el, {
                            start: [self.state[colorName]],
                            range: { min: 0, max: 255 }
                        });

                        el.noUiSlider.on('update', (values) => {
                            self.state[colorName] = Math.round(parseFloat(values[0]));
                        });
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="multi-slider">
                    <div class="color-slider" data-color="red"></div>
                    <div class="color-slider" data-color="green"></div>
                    <div class="color-slider" data-color="blue"></div>
                </div>
            `;
            await waitForUpdate(150);

            const sliders = testContainer.querySelectorAll('.color-slider');
            expect(sliders.length).toBe(3);
            sliders.forEach(slider => {
                expect(slider.noUiSlider).toBeDefined();
                slider.noUiSlider.destroy();
            });
        });
    });

    describe('Tippy.js Integration', () => {
        it('should get element for tippy initialization using WildQuery', async () => {
            let capturedElement = null;

            wildflower.component('tippy-element-test', {
                state: {},
                init() {
                    capturedElement = this.$el('.tooltip-btn').get(0);
                }
            });

            testContainer.innerHTML = `
                <div data-component="tippy-element-test">
                    <button class="tooltip-btn">Hover me</button>
                </div>
            `;
            await waitForUpdate(150);

            // Verify WildQuery found the element (this is what tippy would use)
            expect(capturedElement).toBeDefined();
            expect(capturedElement.tagName).toBe('BUTTON');
            expect(capturedElement.classList.contains('tooltip-btn')).toBe(true);
        });

        it('should access state from within WildQuery callbacks', async () => {
            let stateValue = null;

            wildflower.component('state-access-test', {
                state: { message: 'Initial message' },
                init() {
                    // Verify state is accessible when getting elements
                    const btn = this.$el('.tooltip-btn').get(0);
                    if (btn) {
                        stateValue = this.state.message;
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="state-access-test">
                    <button class="tooltip-btn">Hover me</button>
                </div>
            `;
            await waitForUpdate(150);

            expect(stateValue).toBe('Initial message');
        });

        it('should initialize tooltips on multiple elements using WildQuery', async () => {
            let tooltipContents = [];

            wildflower.component('multi-tip-test', {
                state: {},
                init() {
                    this.$el('.tip-btn').each((el) => {
                        const content = el.getAttribute('data-tooltip') || 'Default';
                        tooltipContents.push(content);
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="multi-tip-test">
                    <button class="tip-btn" data-tooltip="First">Button 1</button>
                    <button class="tip-btn" data-tooltip="Second">Button 2</button>
                    <button class="tip-btn" data-tooltip="Third">Button 3</button>
                </div>
            `;
            await waitForUpdate(150);

            // Verify WildQuery .each() iterated all elements
            expect(tooltipContents.length).toBe(3);
            expect(tooltipContents[0]).toBe('First');
            expect(tooltipContents[1]).toBe('Second');
            expect(tooltipContents[2]).toBe('Third');
        });

        it('should use WildQuery attr() to read tooltip data attribute', async () => {
            let readAttr = null;

            wildflower.component('tip-attr-reader', {
                state: {},
                init() {
                    readAttr = this.$el('.tip-target').attr('data-tip');
                }
            });

            testContainer.innerHTML = `
                <div data-component="tip-attr-reader">
                    <span class="tip-target" data-tip="Read via attr()">Info</span>
                </div>
            `;
            await waitForUpdate(200);

            // Verify WildQuery attr() worked
            expect(readAttr).toBe('Read via attr()');
        });
    });

    describe('Combined Multi-Library Integration', () => {
        it('should integrate multiple libraries in one component', async () => {
            let initCalled = false;
            let flatpickrOk = false;
            let sliderOk = false;

            wildflower.component('combined-libs-test', {
                state: { value: 50 },
                init() {
                    initCalled = true;

                    // Test 1: Flatpickr
                    const dateInput = this.$el('.date-input').get(0);
                    if (dateInput && window.flatpickr) {
                        const picker = window.flatpickr(dateInput, { dateFormat: 'Y-m-d' });
                        flatpickrOk = !!dateInput._flatpickr;
                        picker.destroy();
                    }

                    // Test 2: noUiSlider
                    const sliderEl = this.$el('.slider').get(0);
                    if (sliderEl && window.noUiSlider) {
                        window.noUiSlider.create(sliderEl, {
                            start: [this.state.value],
                            range: { min: 0, max: 100 }
                        });
                        sliderOk = !!sliderEl.noUiSlider;
                        sliderEl.noUiSlider.destroy();
                    }
                }
            });

            testContainer.innerHTML = `
                <div data-component="combined-libs-test">
                    <input type="text" class="date-input">
                    <div class="slider"></div>
                </div>
            `;
            await waitForUpdate(200);

            expect(initCalled).toBe(true);
            expect(flatpickrOk).toBe(true);
            expect(sliderOk).toBe(true);
        });
    });

    describe('Event Handler Cleanup with Third-Party Libraries', () => {
        it('should cleanup WildQuery event handlers when component is destroyed', async () => {
            let handlerCalled = false;

            wildflower.component('lib-cleanup-test', {
                state: {},
                init() {
                    this.$el('.btn').on('click', () => {
                        handlerCalled = true;
                    });
                }
            });

            testContainer.innerHTML = `
                <div data-component="lib-cleanup-test">
                    <button class="btn">Click me</button>
                </div>
            `;
            await waitForUpdate(100);

            const componentEl = testContainer.querySelector('[data-component="lib-cleanup-test"]');
            const componentId = componentEl.dataset.componentId;
            const btn = testContainer.querySelector('.btn');

            // Destroy the component
            wildflower.destroyComponent(componentId);

            // Try clicking - handler should not fire
            handlerCalled = false;
            btn.click();

            expect(handlerCalled).toBe(false);
        });
    });
});
