/**
 * UAM Tutorial Plugin
 *
 * A framework-agnostic tutorial/onboarding system that works with any
 * UAM-compiled application (WildflowerJS, Vue, React, etc.)
 *
 * Usage:
 *   // Define a tour
 *   UAMTutorial.define('my-tour', {
 *     steps: [
 *       { target: '.my-element', title: 'Welcome', content: 'Description...', position: 'bottom' }
 *     ]
 *   });
 *
 *   // Start the tour
 *   UAMTutorial.start('my-tour');
 */

(function(global) {
    'use strict';

    // =========================================================================
    // STYLES
    // =========================================================================
    const STYLES = `
        .uam-tutorial-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 9998;
            pointer-events: none;
        }

        .uam-tutorial-spotlight {
            position: fixed;
            z-index: 9999;
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.75);
            border-radius: 4px;
            pointer-events: none;
            transition: all 0.3s ease;
        }

        .uam-tutorial-popover {
            position: fixed;
            z-index: 10000;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            max-width: 320px;
            min-width: 250px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .uam-tutorial-popover-header {
            padding: 16px 16px 12px;
            border-bottom: 1px solid #e0e0e0;
        }

        .uam-tutorial-popover-title {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: #333;
        }

        .uam-tutorial-popover-body {
            padding: 12px 16px;
        }

        .uam-tutorial-popover-content {
            font-size: 14px;
            line-height: 1.5;
            color: #555;
            margin: 0;
        }

        .uam-tutorial-popover-footer {
            padding: 12px 16px;
            border-top: 1px solid #e0e0e0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .uam-tutorial-progress {
            font-size: 12px;
            color: #888;
        }

        .uam-tutorial-buttons {
            display: flex;
            gap: 8px;
        }

        .uam-tutorial-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
        }

        .uam-tutorial-btn-secondary {
            background: #f0f0f0;
            color: #555;
        }

        .uam-tutorial-btn-secondary:hover {
            background: #e0e0e0;
        }

        .uam-tutorial-btn-primary {
            background: #667eea;
            color: white;
        }

        .uam-tutorial-btn-primary:hover {
            background: #5a6fd6;
        }

        .uam-tutorial-btn-close {
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            font-size: 18px;
            color: #999;
            cursor: pointer;
            padding: 4px;
            line-height: 1;
        }

        .uam-tutorial-btn-close:hover {
            color: #333;
        }

        /* Arrow styles */
        .uam-tutorial-popover::before {
            content: '';
            position: absolute;
            width: 12px;
            height: 12px;
            background: white;
            transform: rotate(45deg);
        }

        .uam-tutorial-popover[data-position="top"]::before {
            bottom: -6px;
            left: 50%;
            margin-left: -6px;
            box-shadow: 3px 3px 3px rgba(0,0,0,0.05);
        }

        .uam-tutorial-popover[data-position="bottom"]::before {
            top: -6px;
            left: 50%;
            margin-left: -6px;
            box-shadow: -2px -2px 3px rgba(0,0,0,0.05);
        }

        .uam-tutorial-popover[data-position="left"]::before {
            right: -6px;
            top: 50%;
            margin-top: -6px;
            box-shadow: 3px -3px 3px rgba(0,0,0,0.05);
        }

        .uam-tutorial-popover[data-position="right"]::before {
            left: -6px;
            top: 50%;
            margin-top: -6px;
            box-shadow: -3px 3px 3px rgba(0,0,0,0.05);
        }
    `;

    // =========================================================================
    // TUTORIAL MANAGER
    // =========================================================================
    class TutorialManager {
        constructor() {
            this.tours = new Map();
            this.currentTour = null;
            this.currentStepIndex = 0;
            this.isActive = false;

            // DOM elements
            this.overlay = null;
            this.spotlight = null;
            this.popover = null;

            // Bound methods for event listeners
            this._handleKeydown = this._handleKeydown.bind(this);
            this._handleResize = this._handleResize.bind(this);
        }

        /**
         * Define a new tour
         * @param {string} name - Tour identifier
         * @param {Object} config - Tour configuration
         * @param {Array} config.steps - Array of step objects
         */
        define(name, config) {
            if (!config || !Array.isArray(config.steps) || config.steps.length === 0) {
                console.error(`[UAMTutorial] Invalid tour config for "${name}": steps array required`);
                return;
            }

            this.tours.set(name, {
                name,
                steps: config.steps,
                onComplete: config.onComplete || null
            });

            console.log(`[UAMTutorial] Defined tour "${name}" with ${config.steps.length} steps`);
        }

        /**
         * Start a tour
         * @param {string} name - Tour identifier
         */
        start(name) {
            const tour = this.tours.get(name);
            if (!tour) {
                console.error(`[UAMTutorial] Tour "${name}" not found`);
                return;
            }

            if (this.isActive) {
                this.stop();
            }

            this.currentTour = tour;
            this.currentStepIndex = 0;
            this.isActive = true;

            this._injectStyles();
            this._createElements();
            this._addEventListeners();
            this._showStep(0);

            console.log(`[UAMTutorial] Started tour "${name}"`);
        }

        /**
         * Go to next step
         */
        next() {
            if (!this.isActive || !this.currentTour) return;

            if (this.currentStepIndex < this.currentTour.steps.length - 1) {
                this.currentStepIndex++;
                this._showStep(this.currentStepIndex);
            } else {
                this._complete();
            }
        }

        /**
         * Go to previous step
         */
        prev() {
            if (!this.isActive || !this.currentTour) return;

            if (this.currentStepIndex > 0) {
                this.currentStepIndex--;
                this._showStep(this.currentStepIndex);
            }
        }

        /**
         * Stop the current tour
         */
        stop() {
            if (!this.isActive) return;

            this._removeElements();
            this._removeEventListeners();

            this.currentTour = null;
            this.currentStepIndex = 0;
            this.isActive = false;

            console.log('[UAMTutorial] Tour stopped');
        }

        // =====================================================================
        // PRIVATE METHODS
        // =====================================================================

        _injectStyles() {
            if (document.getElementById('uam-tutorial-styles')) return;

            const styleEl = document.createElement('style');
            styleEl.id = 'uam-tutorial-styles';
            styleEl.textContent = STYLES;
            document.head.appendChild(styleEl);
        }

        _createElements() {
            // Overlay (for click blocking on background)
            this.overlay = document.createElement('div');
            this.overlay.className = 'uam-tutorial-overlay';
            document.body.appendChild(this.overlay);

            // Spotlight
            this.spotlight = document.createElement('div');
            this.spotlight.className = 'uam-tutorial-spotlight';
            document.body.appendChild(this.spotlight);

            // Popover
            this.popover = document.createElement('div');
            this.popover.className = 'uam-tutorial-popover';
            document.body.appendChild(this.popover);
        }

        _removeElements() {
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
            }
            if (this.spotlight) {
                this.spotlight.remove();
                this.spotlight = null;
            }
            if (this.popover) {
                this.popover.remove();
                this.popover = null;
            }
        }

        _addEventListeners() {
            document.addEventListener('keydown', this._handleKeydown);
            window.addEventListener('resize', this._handleResize);
        }

        _removeEventListeners() {
            document.removeEventListener('keydown', this._handleKeydown);
            window.removeEventListener('resize', this._handleResize);
        }

        _handleKeydown(e) {
            if (!this.isActive) return;

            switch (e.key) {
                case 'ArrowRight':
                case 'Enter':
                    e.preventDefault();
                    this.next();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.prev();
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.stop();
                    break;
            }
        }

        _handleResize() {
            if (this.isActive) {
                this._showStep(this.currentStepIndex);
            }
        }

        _showStep(index) {
            const step = this.currentTour.steps[index];
            const target = document.querySelector(step.target);

            if (!target) {
                console.warn(`[UAMTutorial] Target "${step.target}" not found, skipping step`);
                // Try next step if target not found
                if (index < this.currentTour.steps.length - 1) {
                    this.currentStepIndex++;
                    this._showStep(this.currentStepIndex);
                } else {
                    this._complete();
                }
                return;
            }

            // Position spotlight around target
            this._positionSpotlight(target);

            // Update and position popover
            this._updatePopover(step, index);
            this._positionPopover(target, step.position || 'bottom');

            // Scroll target into view if needed
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        _positionSpotlight(target) {
            const rect = this._getVisibleBounds(target);
            const padding = 8;

            this.spotlight.style.left = (rect.left - padding) + 'px';
            this.spotlight.style.top = (rect.top - padding) + 'px';
            this.spotlight.style.width = (rect.width + padding * 2) + 'px';
            this.spotlight.style.height = (rect.height + padding * 2) + 'px';
        }

        _getVisibleBounds(element) {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            const hasOverflow = style.overflowX === 'auto' || style.overflowX === 'scroll' ||
                               style.overflowY === 'auto' || style.overflowY === 'scroll';

            if (hasOverflow && element.children.length > 0) {
                let minLeft = Infinity, minTop = Infinity;
                let maxRight = -Infinity, maxBottom = -Infinity;

                for (const child of element.children) {
                    const childRect = child.getBoundingClientRect();
                    if (childRect.width > 0 && childRect.height > 0) {
                        minLeft = Math.min(minLeft, childRect.left);
                        minTop = Math.min(minTop, childRect.top);
                        maxRight = Math.max(maxRight, childRect.right);
                        maxBottom = Math.max(maxBottom, childRect.bottom);
                    }
                }

                if (minLeft !== Infinity) {
                    return {
                        left: minLeft,
                        top: minTop,
                        width: maxRight - minLeft,
                        height: maxBottom - minTop,
                        right: maxRight,
                        bottom: maxBottom
                    };
                }
            }

            return rect;
        }

        _updatePopover(step, index) {
            const totalSteps = this.currentTour.steps.length;
            const isFirst = index === 0;
            const isLast = index === totalSteps - 1;

            this.popover.innerHTML = `
                <button class="uam-tutorial-btn-close" aria-label="Close tutorial">&times;</button>
                <div class="uam-tutorial-popover-header">
                    <h3 class="uam-tutorial-popover-title">${step.title}</h3>
                </div>
                <div class="uam-tutorial-popover-body">
                    <p class="uam-tutorial-popover-content">${step.content}</p>
                </div>
                <div class="uam-tutorial-popover-footer">
                    <span class="uam-tutorial-progress">Step ${index + 1} of ${totalSteps}</span>
                    <div class="uam-tutorial-buttons">
                        ${!isFirst ? '<button class="uam-tutorial-btn uam-tutorial-btn-secondary" data-action="prev">Previous</button>' : ''}
                        <button class="uam-tutorial-btn uam-tutorial-btn-primary" data-action="${isLast ? 'finish' : 'next'}">
                            ${isLast ? 'Finish' : 'Next'}
                        </button>
                    </div>
                </div>
            `;

            // Add click handlers
            this.popover.querySelector('.uam-tutorial-btn-close').addEventListener('click', () => this.stop());

            const prevBtn = this.popover.querySelector('[data-action="prev"]');
            if (prevBtn) {
                prevBtn.addEventListener('click', () => this.prev());
            }

            const nextBtn = this.popover.querySelector('[data-action="next"]');
            if (nextBtn) {
                nextBtn.addEventListener('click', () => this.next());
            }

            const finishBtn = this.popover.querySelector('[data-action="finish"]');
            if (finishBtn) {
                finishBtn.addEventListener('click', () => this._complete());
            }
        }

        _positionPopover(target, position) {
            const targetRect = target.getBoundingClientRect();
            const popoverRect = this.popover.getBoundingClientRect();
            const gap = 16;

            let left, top;

            switch (position) {
                case 'top':
                    left = targetRect.left + (targetRect.width / 2) - (popoverRect.width / 2);
                    top = targetRect.top - popoverRect.height - gap;
                    break;

                case 'bottom':
                    left = targetRect.left + (targetRect.width / 2) - (popoverRect.width / 2);
                    top = targetRect.bottom + gap;
                    break;

                case 'left':
                    left = targetRect.left - popoverRect.width - gap;
                    top = targetRect.top + (targetRect.height / 2) - (popoverRect.height / 2);
                    break;

                case 'right':
                    left = targetRect.right + gap;
                    top = targetRect.top + (targetRect.height / 2) - (popoverRect.height / 2);
                    break;

                default:
                    left = targetRect.left + (targetRect.width / 2) - (popoverRect.width / 2);
                    top = targetRect.bottom + gap;
                    position = 'bottom';
            }

            // Keep popover within viewport
            const viewportPadding = 10;
            left = Math.max(viewportPadding, Math.min(left, window.innerWidth - popoverRect.width - viewportPadding));
            top = Math.max(viewportPadding, Math.min(top, window.innerHeight - popoverRect.height - viewportPadding));

            this.popover.style.left = left + 'px';
            this.popover.style.top = top + 'px';
            this.popover.setAttribute('data-position', position);
        }

        _complete() {
            const tour = this.currentTour;
            this.stop();

            if (tour && tour.onComplete) {
                tour.onComplete();
            }

            console.log('[UAMTutorial] Tour completed');
        }
    }

    // =========================================================================
    // GLOBAL REGISTRATION
    // =========================================================================
    const manager = new TutorialManager();

    // Expose as global UAMTutorial
    global.UAMTutorial = {
        define: (name, config) => manager.define(name, config),
        start: (name) => manager.start(name),
        next: () => manager.next(),
        prev: () => manager.prev(),
        stop: () => manager.stop(),
        isActive: () => manager.isActive
    };

    // Also register with WildflowerJS if available (for backwards compatibility)
    if (typeof global.wildflower !== 'undefined' && global.wildflower.plugin) {
        global.wildflower.plugin({
            name: 'tutorial',
            install(wf) {
                wf.tutorial = global.UAMTutorial;
                console.log('[UAMTutorial] Registered with WildflowerJS');
            }
        });
    }

    console.log('[UAMTutorial] Plugin loaded');

})(typeof window !== 'undefined' ? window : global);
