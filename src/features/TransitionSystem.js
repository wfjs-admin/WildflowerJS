/**
 * TransitionSystem - CSS transitions
 *
 * @module
 */

/**
 * Methods to be mixed into WildflowerJS.prototype
 */
export const TransitionSystemMethods = {
/**
     * Handle visibility change with transition support
     * Called when data-show or data-render changes and element has data-transition
     * @param {HTMLElement} element - The element being shown/hidden
     * @param {Object} context - The conditional context
     * @param {boolean} isVisible - Target visibility state
     * @param {Object} instance - Component instance (for JS hooks)
     * @private
     */
    _handleTransitionedVisibilityChange(element, context, isVisible, instance)
    {
        const transitionName = element.dataset.transition;
        if (!transitionName) {
            // No transition, use default behavior
            context._updateConditionalElement(isVisible);
            return;
        }

        // Use element properties for ALL state tracking (simpler, more reliable)
        // _transitionTarget: the visibility state we're at or transitioning to
        // _transitionInProgress: whether a transition animation is running
        // _transitionLock: prevent re-entrant calls during hook execution

        // First render: initialize without animation
        if (element._transitionTarget === undefined) {
            element._transitionTarget = isVisible;
            if (context.mode !== 'render') {
                element.style.display = isVisible ? '' : 'none';
            } else {
                context._updateConditionalElement(isVisible);
            }
            return;
        }

        // Prevent re-entrant calls (e.g., from hooks modifying state)
        if (element._transitionLock) {
            return;
        }

        // Already at or transitioning to this state: skip
        if (element._transitionTarget === isVisible) {
            return;
        }

        // Cancel any pending transition (both RAF and timeout)
        if (element._transitionRAF) {
            cancelAnimationFrame(element._transitionRAF);
            element._transitionRAF = null;
        }
        if (element._transitionTimeout) {
            clearTimeout(element._transitionTimeout);
            element._transitionTimeout = null;
        }

        // Clean up any existing transition classes
        this._cleanupTransitionClasses(element, transitionName);

        // Set new target BEFORE starting transition
        element._transitionTarget = isVisible;
        element._transitionInProgress = true;

        if (isVisible) {
            this._runEnterTransition(element, transitionName, context, instance);
        } else {
            this._runLeaveTransition(element, transitionName, context, instance);
        }
    },
    /**
     * Run enter transition (element becoming visible)
     * @param {HTMLElement} element - The element
     * @param {string} transitionName - Transition name (e.g., 'fade')
     * @param {Object} context - Conditional context
     * @param {Object} instance - Component instance
     * @private
     */
    _runEnterTransition(element, transitionName, context, instance)
    {
        const enterClass = `${transitionName}-enter`;
        const enterActiveClass = `${transitionName}-enter-active`;

        // Call JS hook: onBeforeEnter (check both instance.context and instance directly)
        const hookContext = instance?.context || instance;
        if (hookContext?.onBeforeEnter) {
            element._transitionLock = true;
            try {
                hookContext.onBeforeEnter.call(hookContext, element);
            } finally {
                element._transitionLock = false;
            }
        }

        // For render mode, we need to insert the element first
        if (context.mode === 'render') {
            // Save transition state from templateClone before inserting
            const savedTransitionTarget = element._transitionTarget;
            const savedTransitionInProgress = element._transitionInProgress;

            // Insert element into DOM (this updates context.element)
            context._updateConditionalElement(true);
            // Get the newly inserted element
            element = context.element;
            if (!element) return; // Safety check

            // Copy transition state to the newly inserted element
            // (cloneNode doesn't copy custom JS properties)
            element._transitionTarget = savedTransitionTarget;
            element._transitionInProgress = savedTransitionInProgress;
        }

        // Step 1: Add enter class (sets initial state like opacity:0, transform, etc.)
        element.classList.add(enterClass);

        // Step 2: Make element visible (for data-show)
        if (context.mode !== 'render') {
            element.style.display = '';
        }

        // Step 3: Force reflow to ensure the initial state is rendered
        void element.offsetHeight;

        // Step 4: Add enter-active class (triggers transition to final state)
        element._transitionRAF = requestAnimationFrame(() => {
            element._transitionRAF = null;

            // Check if transition was canceled
            if (element._transitionTarget !== true) return;

            element.classList.add(enterActiveClass);

            // Call JS hook: onEnter
            if (hookContext?.onEnter) {
                element._transitionLock = true;
                try {
                    hookContext.onEnter.call(hookContext, element, () => {});
                } finally {
                    element._transitionLock = false;
                }
            }

            // Step 5: Wait for transition to complete, then clean up
            const duration = this._getTransitionDuration(element);
            element._transitionTimeout = setTimeout(() => {
                element.classList.remove(enterClass);
                element.classList.remove(enterActiveClass);
                element._transitionTimeout = null;
                element._transitionInProgress = false;

                // Call JS hook: onAfterEnter
                if (hookContext?.onAfterEnter) {
                    element._transitionLock = true;
                    try {
                        hookContext.onAfterEnter.call(hookContext, element);
                    } finally {
                        element._transitionLock = false;
                    }
                }
            }, duration);
        });
    },
    /**
     * Run leave transition (element becoming hidden)
     * @param {HTMLElement} element - The element
     * @param {string} transitionName - Transition name (e.g., 'fade')
     * @param {Object} context - Conditional context
     * @param {Object} instance - Component instance
     * @private
     */
    _runLeaveTransition(element, transitionName, context, instance)
    {
        const leaveClass = `${transitionName}-leave`;
        const leaveActiveClass = `${transitionName}-leave-active`;

        // Call JS hook: onBeforeLeave (check both instance.context and instance directly)
        const hookContext = instance?.context || instance;
        if (hookContext?.onBeforeLeave) {
            element._transitionLock = true;
            try {
                hookContext.onBeforeLeave.call(hookContext, element);
            } finally {
                element._transitionLock = false;
            }
        }

        // Step 1: Add leave class (captures current/initial state for leave)
        element.classList.add(leaveClass);

        // Step 2: Force reflow
        void element.offsetHeight;

        // Step 3: Add leave-active class (triggers transition to end state)
        element._transitionRAF = requestAnimationFrame(() => {
            element._transitionRAF = null;

            // Check if transition was canceled
            if (element._transitionTarget !== false) return;

            element.classList.add(leaveActiveClass);

            // Call JS hook: onLeave
            if (hookContext?.onLeave) {
                element._transitionLock = true;
                try {
                    hookContext.onLeave.call(hookContext, element, () => {});
                } finally {
                    element._transitionLock = false;
                }
            }

            // Step 4: Wait for transition to complete, then hide/remove
            const duration = this._getTransitionDuration(element);
            element._transitionTimeout = setTimeout(() => {
                element._transitionTimeout = null;
                element._transitionInProgress = false;

                // Hide FIRST (before removing classes) to prevent the
                // element's base CSS from triggering a reverse transition
                // (e.g., grid-template-rows reverting from 0fr to 1fr).
                // Leave classes are cleaned up at the start of the next
                // transition via _cleanupTransitionClasses.
                context._updateConditionalElement(false);

                // Reset transition state on templateClone so the next
                // show cycle starts fresh (not skipped as "already at this state")
                if (context.mode === 'render' && context.templateClone) {
                    context.templateClone._transitionTarget = undefined;
                }

                // Call JS hook: onAfterLeave
                if (hookContext?.onAfterLeave) {
                    element._transitionLock = true;
                    try {
                        hookContext.onAfterLeave.call(hookContext, element);
                    } finally {
                        element._transitionLock = false;
                    }
                }
            }, duration);
        });
    },
    /**
     * Get the CSS transition duration for an element
     * @param {HTMLElement} element - The element
     * @returns {number} Duration in milliseconds
     * @private
     */
    _getTransitionDuration(element)
    {
        const style = getComputedStyle(element);

        // Check transition-duration and animation-duration
        // These can be comma-separated for multiple properties (e.g., "1s, 0.5s")
        const transitionDuration = style.transitionDuration;
        const animationDuration = style.animationDuration;

        // Parse a single duration value (e.g., '0.3s' or '300ms')
        const parseSingleDuration = (durationStr) => {
            if (!durationStr) return 0;
            const trimmed = durationStr.trim();
            if (trimmed === '0s' || trimmed === '0ms') return 0;
            const match = trimmed.match(/^([\d.]+)(s|ms)$/);
            if (!match) return 0;
            const value = parseFloat(match[1]);
            return match[2] === 's' ? value * 1000 : value;
        };

        // Parse comma-separated durations and return the maximum
        const parseMaxDuration = (durationStr) => {
            if (!durationStr) return 0;
            const durations = durationStr.split(',').map(parseSingleDuration);
            return Math.max(...durations, 0);
        };

        // Get the longest duration from transition or animation
        const tDuration = parseMaxDuration(transitionDuration);
        const aDuration = parseMaxDuration(animationDuration);

        // Return the maximum, with a small buffer for safety (1 frame at 60fps)
        const maxDuration = Math.max(tDuration, aDuration);
        return maxDuration > 0 ? maxDuration + 16 : 0;
    },
    /**
     * Clean up any transition classes from an element
     * @param {HTMLElement} element - The element
     * @param {string} transitionName - Transition name
     * @private
     */
    _cleanupTransitionClasses(element, transitionName)
    {
        element.classList.remove(`${transitionName}-enter`);
        element.classList.remove(`${transitionName}-enter-active`);
        element.classList.remove(`${transitionName}-leave`);
        element.classList.remove(`${transitionName}-leave-active`);
    }
    // #endregion FEATURE_TRANSITIONS
};
