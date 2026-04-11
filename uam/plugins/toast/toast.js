/**
 * WildflowerJS Toast Plugin
 * Lightweight toast notifications for user feedback
 *
 * Usage:
 *   wfToast.success('Item added to cart!');
 *   wfToast.error('Something went wrong');
 *   wfToast.info('New updates available');
 *   wfToast.warning('Low stock warning');
 *
 * Options:
 *   wfToast.success('Message', {
 *     duration: 3000,      // Auto-dismiss time in ms (0 = no auto-dismiss)
 *     position: 'top-right', // top-right, top-left, bottom-right, bottom-left
 *     dismissible: true    // Show close button
 *   });
 */
(function() {
  'use strict';

  // Default configuration
  const defaults = {
    duration: 3000,
    position: 'top-right',
    dismissible: true,
    maxToasts: 5
  };

  // Toast container reference
  let container = null;

  // Active toasts queue
  const toasts = [];

  // Icons for each toast type (simple SVG paths)
  const icons = {
    success: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  /**
   * Create or get the toast container
   */
  function getContainer(position) {
    // Check if container exists with correct position
    if (container && container.dataset.position === position) {
      return container;
    }

    // Remove existing container if position changed
    if (container) {
      container.remove();
    }

    // Create new container
    container = document.createElement('div');
    container.className = 'wf-toast-container';
    container.dataset.position = position;

    // Set position styles
    const positions = {
      'top-right': { top: '20px', right: '20px' },
      'top-left': { top: '20px', left: '20px' },
      'bottom-right': { bottom: '20px', right: '20px' },
      'bottom-left': { bottom: '20px', left: '20px' },
      'top-center': { top: '20px', left: '50%', transform: 'translateX(-50%)' },
      'bottom-center': { bottom: '20px', left: '50%', transform: 'translateX(-50%)' }
    };

    Object.assign(container.style, {
      position: 'fixed',
      zIndex: '10000',
      display: 'flex',
      flexDirection: position.startsWith('bottom') ? 'column-reverse' : 'column',
      gap: '10px',
      pointerEvents: 'none',
      ...positions[position] || positions['top-right']
    });

    document.body.appendChild(container);
    return container;
  }

  /**
   * Create a toast element
   */
  function createToast(message, type, options) {
    const opts = { ...defaults, ...options };
    const cont = getContainer(opts.position);

    // Limit max toasts
    while (toasts.length >= opts.maxToasts) {
      const oldest = toasts.shift();
      if (oldest && oldest.element) {
        dismissToast(oldest.element);
      }
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `wf-toast wf-toast-${type}`;
    toast.style.pointerEvents = 'auto';

    // Build toast HTML
    toast.innerHTML = `
      <span class="wf-toast-icon">${icons[type] || icons.info}</span>
      <span class="wf-toast-message">${escapeHtml(message)}</span>
      ${opts.dismissible ? '<button class="wf-toast-close" aria-label="Close">&times;</button>' : ''}
      ${opts.duration > 0 ? '<div class="wf-toast-progress"><div class="wf-toast-progress-bar"></div></div>' : ''}
    `;

    // Add close button handler
    if (opts.dismissible) {
      const closeBtn = toast.querySelector('.wf-toast-close');
      closeBtn.addEventListener('click', () => dismissToast(toast));
    }

    // Add to container with animation
    cont.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      toast.classList.add('wf-toast-visible');
    });

    // Start progress bar animation
    if (opts.duration > 0) {
      const progressBar = toast.querySelector('.wf-toast-progress-bar');
      if (progressBar) {
        progressBar.style.transition = `width ${opts.duration}ms linear`;
        requestAnimationFrame(() => {
          progressBar.style.width = '0%';
        });
      }
    }

    // Track toast
    const toastObj = {
      element: toast,
      timeout: opts.duration > 0 ? setTimeout(() => dismissToast(toast), opts.duration) : null
    };
    toasts.push(toastObj);

    return toast;
  }

  /**
   * Dismiss a toast with animation
   */
  function dismissToast(toast) {
    if (!toast || toast.classList.contains('wf-toast-hiding')) return;

    toast.classList.add('wf-toast-hiding');
    toast.classList.remove('wf-toast-visible');

    // Remove from tracking
    const index = toasts.findIndex(t => t.element === toast);
    if (index > -1) {
      const toastObj = toasts[index];
      if (toastObj.timeout) clearTimeout(toastObj.timeout);
      toasts.splice(index, 1);
    }

    // Remove element after animation
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Public API
   */
  const wfToast = {
    success: (message, options) => createToast(message, 'success', options),
    error: (message, options) => createToast(message, 'error', options),
    warning: (message, options) => createToast(message, 'warning', options),
    info: (message, options) => createToast(message, 'info', options),

    // Dismiss all toasts
    clear: () => {
      toasts.forEach(t => dismissToast(t.element));
    },

    // Configure defaults
    configure: (options) => {
      Object.assign(defaults, options);
    }
  };

  // Expose globally
  window.wfToast = wfToast;

  // Inject styles if not already present
  if (!document.getElementById('wf-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'wf-toast-styles';
    style.textContent = `
      .wf-toast {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 280px;
        max-width: 400px;
        padding: 14px 16px;
        background: #fff;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        color: #333;
        opacity: 0;
        transform: translateX(100%);
        transition: opacity 0.3s, transform 0.3s;
        position: relative;
        overflow: hidden;
      }

      .wf-toast-container[data-position^="left"] .wf-toast {
        transform: translateX(-100%);
      }

      .wf-toast-container[data-position*="center"] .wf-toast {
        transform: translateY(-20px);
      }

      .wf-toast-visible {
        opacity: 1;
        transform: translateX(0) translateY(0);
      }

      .wf-toast-hiding {
        opacity: 0;
        transform: translateX(100%);
      }

      .wf-toast-container[data-position^="left"] .wf-toast-hiding {
        transform: translateX(-100%);
      }

      .wf-toast-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .wf-toast-message {
        flex: 1;
        line-height: 1.4;
      }

      .wf-toast-close {
        flex-shrink: 0;
        background: none;
        border: none;
        font-size: 20px;
        color: #999;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        margin-left: 8px;
      }

      .wf-toast-close:hover {
        color: #666;
      }

      .wf-toast-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: rgba(0, 0, 0, 0.1);
      }

      .wf-toast-progress-bar {
        height: 100%;
        width: 100%;
        transition: width linear;
      }

      /* Toast types */
      .wf-toast-success {
        border-left: 4px solid #10b981;
      }
      .wf-toast-success .wf-toast-icon {
        color: #10b981;
      }
      .wf-toast-success .wf-toast-progress-bar {
        background: #10b981;
      }

      .wf-toast-error {
        border-left: 4px solid #ef4444;
      }
      .wf-toast-error .wf-toast-icon {
        color: #ef4444;
      }
      .wf-toast-error .wf-toast-progress-bar {
        background: #ef4444;
      }

      .wf-toast-warning {
        border-left: 4px solid #f59e0b;
      }
      .wf-toast-warning .wf-toast-icon {
        color: #f59e0b;
      }
      .wf-toast-warning .wf-toast-progress-bar {
        background: #f59e0b;
      }

      .wf-toast-info {
        border-left: 4px solid #3b82f6;
      }
      .wf-toast-info .wf-toast-icon {
        color: #3b82f6;
      }
      .wf-toast-info .wf-toast-progress-bar {
        background: #3b82f6;
      }
    `;
    document.head.appendChild(style);
  }
})();
