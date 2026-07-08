/**
 * BindingWriters: canonical leaf-writers that apply a resolved value to an element.
 *
 * Consolidates the per-binding-type "apply value to element" logic that had drifted
 * across RenderingCore / ListItemBinding / ListExpressionEval / TemplateSystem /
 * the record classes. One writer per binding type keeps the behavior (and its
 * edge cases) defined in exactly one place instead of six.
 *
 * @module
 */

import { __wf_str, __wf_txt } from './wfUtils.js';

/**
 * Apply a data-show visibility verdict to an element.
 *
 * Toggles `display` AND the `.wf-show` class so the documented anti-FOUC contract,
 * `[data-show]:not(.wf-show) { display: none }`, holds on every path. Previously only
 * the context path added the class, so the contract silently failed for data-show inside
 * components and list rows. The display write is guarded against redundant mutation; the
 * class toggle is unguarded because a visible element may already carry `display:''`
 * (nothing to write) yet still need `.wf-show` added on first apply.
 *
 * Not used by PoolRenderer's per-frame loop: pool entities are created at runtime and can
 * never flash from initial HTML, so the anti-FOUC class is meaningless there.
 *
 * @param {Element} element
 * @param {boolean} visible
 */
export function applyShow(element, visible) {
    const display = visible ? '' : 'none';
    if (element.style.display !== display) {
        element.style.display = display;
    }
    // Guard the anti-FOUC class toggle against redundant mutation. The first apply
    // (_wfShowState undefined) always writes so the class is present/absent per the
    // contract even when display:'' needs no write; later applies touch classList
    // only when visibility actually flips. On a same-key list replace the row is
    // re-shown every cycle with an unchanged verdict; this skips that churn.
    if (element._wfShowState !== visible) {
        element._wfShowState = visible;
        if (visible) {
            element.classList.add('wf-show');
        } else {
            element.classList.remove('wf-show');
        }
    }
}

/**
 * Apply a resolved data-model value to a form element (state → DOM sync).
 *
 * Guards every write against the element's current DOM value so a redundant
 * programmatic sync can't move the caret during typing. `kind` selects the input
 * semantics; anything other than 'checkbox'/'radio'/'select-multiple' is treated
 * as a plain value input. Callers own their own pre-checks (focus skip,
 * custom-element adapter, list-bound skip, non-form-element guard) before
 * delegating the write here.
 *
 * @param {Element} element
 * @param {*} value
 * @param {string} [kind] - 'checkbox' | 'radio' | 'select-multiple' | (else) value
 */
export function applyModel(element, value, kind) {
    if (kind === 'checkbox') {
        const isChecked = !!value;
        if (element.checked !== isChecked) element.checked = isChecked;
    } else if (kind === 'radio') {
        const shouldCheck = element.value === String(value);
        if (element.checked !== shouldCheck) element.checked = shouldCheck;
    } else if (kind === 'select-multiple') {
        const values = Array.isArray(value) ? value.map(String) : [];
        for (const opt of element.options) opt.selected = values.includes(opt.value);
    } else {
        const strValue = value == null ? '' : String(value);
        if (element.value !== strValue) element.value = strValue;
    }
}

/** Boolean HTML attributes where presence = active (regardless of value) */
export const BOOLEAN_HTML_ATTRS = new Set([
    'disabled', 'readonly', 'required', 'checked', 'selected',
    'multiple', 'hidden', 'autofocus', 'autoplay', 'controls',
    'loop', 'muted', 'default', 'defer', 'async', 'novalidate',
    'formnovalidate', 'open', 'reversed', 'allowfullscreen',
    'ismap', 'nomodule', 'playsinline', 'disablepictureinpicture'
]);

/**
 * Apply a data-bind-attr object to an element.
 *
 * Canonical semantics (converging the previously-drifted list and component paths):
 * - null/undefined        -> removeAttribute
 * - false on boolean attr -> removeAttribute (presence = active, so false = absent)
 * - false on other attr   -> literal `="false"` (non-boolean attrs keep literal values)
 * - true on boolean attr  -> `=""` (canonical presence form)
 * - true on other attr    -> literal `="true"`
 * - anything else         -> String(value), skipping the write when the attribute already
 *                            holds it (some elements, notably <video>, reload their resource
 *                            when `src` is re-set even to an identical string)
 *
 * Also tracks bound attribute names on element._boundAttrProps and removes attributes whose
 * keys drop out of the bound object on a later apply; without this, a key disappearing from
 * the bound result would leave its stale attribute on the element (previously the component
 * path never cleared these).
 *
 * @param {Element} element
 * @param {Object} object - attribute name -> raw bound value
 * @param {Object} [helpers]
 * @param {(prop: string) => boolean} [helpers.isBlocklisted] - security blocklist check
 * @param {(prop: string, value: any) => any} [helpers.sanitize] - value sanitizer (may return null to drop)
 */
export function applyAttrObj(element, object, helpers) {
    const isBlocklisted = helpers && helpers.isBlocklisted;
    const sanitize = helpers && helpers.sanitize;

    // Clear previously-bound attributes whose keys are no longer in the object.
    const prev = element._boundAttrProps;
    if (prev && prev.size > 0) {
        for (const prop of prev) {
            if (Object.prototype.hasOwnProperty.call(object, prop)) continue;
            try {
                if (element.hasAttribute(prop)) element.removeAttribute(prop);
            } catch (e) { /* invalid attribute name - skip */ }
            prev.delete(prop);
        }
    }

    for (const [prop, value] of Object.entries(object)) {
        try {
            if (isBlocklisted && isBlocklisted(prop)) {
                if (__DEV__) console.warn(`[WildflowerJS] Cannot bind blacklisted attribute: ${prop}`);
                continue;
            }

            const sanitized = sanitize ? sanitize(prop, value) : value;
            const isBooleanAttr = BOOLEAN_HTML_ATTRS.has(prop.toLowerCase());

            if (sanitized === null || sanitized === undefined) {
                if (element.hasAttribute(prop)) element.removeAttribute(prop);
            } else if (sanitized === false && isBooleanAttr) {
                if (element.hasAttribute(prop)) element.removeAttribute(prop);
            } else if (sanitized === true && isBooleanAttr) {
                if (element.getAttribute(prop) !== '') element.setAttribute(prop, '');
            } else {
                const strValue = String(sanitized);
                if (element.getAttribute(prop) !== strValue) {
                    element.setAttribute(prop, strValue);
                }
            }
        } catch (e) {
            // Invalid attribute name/value - skip silently
        }
    }

    // Track which attributes were bound for cleanup on later applies
    if (!element._boundAttrProps) {
        element._boundAttrProps = new Set();
    }
    Object.keys(object).forEach(prop => element._boundAttrProps.add(prop));
}

/**
 * Apply one resolved style property to an element's style.
 *
 * Correctly handles the two cases the bare `style[prop] = value` setter gets wrong:
 * custom properties (`--x`, which silently no-op via `style[prop]` and require
 * `setProperty`) and `!important` (which the setter drops). Keeps a fast path (a
 * regular property with a plain value and no `!important` is a single assignment,
 * no string scan or allocation) for the per-row / per-frame hot path.
 *
 * @param {CSSStyleDeclaration} style
 * @param {string} prop - camelCase/kebab property, or a `--custom` property
 * @param {*} value
 */
export function applyStyleProp(style, prop, value) {
    if (value == null || value === false) {
        if (prop.charCodeAt(0) === 45) style.removeProperty(prop);
        else style[prop] = '';
        return;
    }
    const v = typeof value === 'string' ? value : String(value);
    // Fast path: regular property, no `!important` (the overwhelmingly common case,
    // e.g. a per-frame `transform` / `background`). `!important` is 10 chars, so a
    // shorter value can't carry it; skip the scan.
    if (prop.charCodeAt(0) !== 45 && (v.length < 10 || v.indexOf('!important') === -1)) {
        style[prop] = v;
        return;
    }
    // Custom property (`--x`) or a value carrying `!important`; must use setProperty.
    if (v.indexOf('!important') !== -1) {
        const name = prop.charCodeAt(0) === 45 ? prop : prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        style.setProperty(name, v.replace(/\s*!important\s*/gi, '').trim(), 'important');
    } else {
        style.setProperty(prop, v);
    }
}

/**
 * Apply a data-bind-style object to an element.
 *
 * Canonical semantics (converging the previously-drifted list and component paths):
 * - null/undefined/false -> clear the property (removeProperty for custom props, '' otherwise)
 * - a value containing `!important` -> applied via setProperty(prop, clean, 'important')
 *   (regular props camelCase->kebab first; custom `--x` props as-is). The component path
 *   previously assigned `el.style[prop] = 'red !important'`, which browsers reject, silently
 *   dropping the priority, and often the whole declaration.
 * - custom properties (`--x`) -> setProperty (style[prop] does not work for them)
 * - everything else -> `element.style[prop] = String(value)` (handles camelCase + kebab)
 *
 * Tracks bound property names on element._boundStyleProps and clears properties whose keys
 * drop out of the object on a later apply; the component path never did this, so a key
 * disappearing from a bound style object left its stale inline style behind.
 *
 * Note: a STRING value (cssText) is intentionally NOT handled here; callers that accept
 * cssText keep their own branch; this writer is the object-form contract only.
 *
 * @param {Element} element
 * @param {Object} object - style property name -> value
 */
export function applyStyleObj(element, object) {
    // Clear previously-bound style props whose keys are no longer in the object.
    const prev = element._boundStyleProps;
    if (prev && prev.size > 0) {
        for (const prop of prev) {
            if (Object.prototype.hasOwnProperty.call(object, prop)) continue;
            try {
                if (prop.startsWith('--')) {
                    element.style.removeProperty(prop);
                } else {
                    element.style[prop] = '';
                }
            } catch (e) { /* invalid property - skip */ }
            prev.delete(prop);
        }
    }

    for (const prop in object) {
        try {
            applyStyleProp(element.style, prop, object[prop]);
        } catch (e) { /* invalid property/value - skip */ }
    }

    if (!element._boundStyleProps) {
        element._boundStyleProps = new Set();
    }
    Object.keys(object).forEach(prop => element._boundStyleProps.add(prop));
}

const EMPTY_CLASSES = [];

/**
 * Apply a data-bind-class value to an element.
 *
 * Canonical diff-tracking semantics (the previously-correct ListItemBinding
 * `_toggleBoundClass` behavior, generalized to objects/arrays):
 * - string  -> space-separated class names
 * - array   -> truthy string entries
 * - object  -> keys whose value is truthy (`{cls: cond}`)
 * - null/undefined/false/'' -> no bound classes (clears all previously bound)
 *
 * Tracks the classes this binding applied on `element._prevBoundClasses` and on a
 * later apply removes only those that drop out, **preserving every non-bound class**
 * (static template classes, `.wf-show`, other bindings' classes). This replaces the
 * compiled-rebind path's `el.className = value`, a full-replace that wiped every
 * non-bound class, and its `classList.toggle` object form, which never removed keys
 * that dropped out of the object.
 *
 * Keeps the early-exit fast path: when the resolved class set is identical to the
 * previously-bound set, return without allocating a Set or touching the DOM (the
 * common steady-state case, e.g. a class ternary re-evaluating to the same result).
 *
 * Shares the `_prevBoundClasses` tracking key with ListRenderer's per-row class
 * paths (which seed it additively on create) so routing through this writer stays
 * coordinate-compatible with them.
 *
 * @param {Element} element
 * @param {string|Object|Array|null} value - resolved class binding value
 */
export function applyClass(element, value) {
    // Normalize the bound value to an array of class names.
    let names;
    if (value == null || value === false || value === '') {
        names = EMPTY_CLASSES;
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        names = trimmed ? trimmed.split(/\s+/) : EMPTY_CLASSES;
    } else if (Array.isArray(value)) {
        names = value.filter(c => c && typeof c === 'string');
    } else if (typeof value === 'object') {
        names = [];
        for (const key in value) {
            if (value[key]) names.push(key);
        }
    } else {
        const trimmed = String(value).trim();
        names = trimmed ? trimmed.split(/\s+/) : EMPTY_CLASSES;
    }

    const prev = element._prevBoundClasses;
    const prevSize = prev ? prev.size : 0;

    // Nothing bound now and nothing bound before; no work.
    if (names.length === 0 && prevSize === 0) return;

    // Early-exit when the set is unchanged: same count and every desired class is
    // already bound. Avoids a Set allocation and any DOM op on the unchanged path.
    if (names.length === prevSize) {
        let allMatch = true;
        for (let i = 0; i < names.length; i++) {
            if (!prev.has(names[i])) { allMatch = false; break; }
        }
        if (allMatch) return;
    }

    const next = new Set();
    for (let i = 0; i < names.length; i++) next.add(names[i]);

    // Remove previously-bound classes that dropped out; preserve all non-bound classes.
    if (prev) {
        for (const cls of prev) {
            if (!next.has(cls)) element.classList.remove(cls);
        }
    }
    for (const cls of next) element.classList.add(cls);

    element._prevBoundClasses = next;
}

/**
 * Apply a data-bind text value to an element's text.
 *
 * Canonical normalization via __wf_str (null/undefined -> '', everything else ->
 * String(value)) and the canonical text write via __wf_txt: a single text-node
 * child is mutated in place through `.data` (preserving node identity and
 * skipping the textContent teardown/re-create), with a textContent fallback
 * for empty/multi-child shapes.
 *
 * Scope: text only. Callers keep their own input/.value branch (a data-bind on
 * an INPUT/TEXTAREA/SELECT writes `.value`, a separate concern from this writer).
 * The hot text paths (`singleTextProp` direct writes in ProxyHandlers /
 * ListRenderer, the number-optimized ListRenderer list writers, the
 * ListItemBinding targeted-rebind, and PoolRenderer's per-frame loop) stay
 * inline by design: staying call-free is load-bearing for targeted-update
 * throughput on large lists.
 *
 * @param {Element} element
 * @param {*} value - resolved text binding value
 */
export function applyText(element, value) {
    __wf_txt(element, __wf_str(value));
}
