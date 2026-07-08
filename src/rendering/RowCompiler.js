/**
 * RowCompiler: per-template row-build specialization for data-list.
 *
 * One emitter set, multiple assembly modes (see docs/future/OPTION_D_INVESTIGATION_2026-06-17.md).
 * Each emitter is derived once per template from the compiled metadata and emits
 * a closure that produces the row's DOM effect. The composed path (this file's
 * v1 scope) runs those closures in a JS loop; later phases add a `new Function`
 * codegen assembly of the same emitters.
 *
 * v1 scope is deliberately narrow: the TEXT-write step of the create path for
 * flat item-property text bindings (the `!needsProxy` shape: a plain text row).
 * Class/style/attr/show/model/render and any expression, dotted, context, state
 * or computed binding are left to the generic path. The compiled path owns only
 * the text write; the onBulkCreate post-pass (class/style/attr) and the per-row
 * update effect (onDeferredEffects) are untouched, so create stays decoupled
 * from update and reactivity is unchanged.
 *
 * Text coercion + the write itself route through the shared wfUtils primitives,
 * so the compiled output is byte-identical to the generic path by construction.
 */

import { __wf_str, __wf_txt } from '../core/wfUtils.js';

/**
 * Runtime mode override (test/validation hook). Unset = auto (compiled path used
 * for eligible templates). 'generic' forces the unchanged per-row text loop
 * everywhere: the escape hatch and the shadow-compare oracle. 'composed' is the
 * explicit opt-in name for the auto behavior (parity with the forced-mode gate
 * the rollout plan runs the suite under).
 */
export function getRowCompileMode() {
    return (typeof globalThis !== 'undefined' && globalThis.__WF_FORCE_ROWCOMPILE__) || null;
}

/**
 * Build (and cache on the metadata) the per-template text-emitter spec, or null
 * when the template has no compilable text binding. Called only from the
 * `!needsProxy` branch, so every binding path here is a flat item property; the
 * checks below are belt-and-suspenders against future callers.
 *
 * @returns {{emitters: Array, rootProp: (string|null)}|null}
 */
export function getTextEmitters(compiledMetadata) {
    let cached = compiledMetadata._rowTextEmitters;
    if (cached !== undefined) return cached;
    cached = buildTextEmitters(compiledMetadata);
    compiledMetadata._rowTextEmitters = cached;
    return cached;
}

function buildTextEmitters(md) {
    const bindings = md.bindings || [];
    const emitters = [];
    for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        // Flat item-prop text only in v1: no expressions, no computed bindings.
        if (b.isExpression || b.isComputed) return null;
        const prop = b.path;
        if (!prop || typeof prop !== 'string') return null;
        // Pure-data emitter (no per-binding closure): applyRowText/applyRowTextUpdate
        // iterate this inline. The closure form added a `.apply()` call per binding
        // per row, measurably heavier on create10k than the inline write the pool
        // path and the old fast-path loop use.
        emitters.push({ kind: 'text', elementIndex: b.index, reads: [prop] });
    }

    let rootProp = null;
    if (md.rootBindings && md.rootBindings.hasBind) {
        rootProp = md.rootBindings.bindPath || null;
        if (rootProp) {
            emitters.push({ kind: 'rootText', elementIndex: 0, reads: [rootProp] });
        }
    }

    if (emitters.length === 0) return null;
    return { emitters, rootProp };
}

/**
 * Run the emitter set against one freshly-cloned row. `els` is the row's
 * binding-element array (same array the generic path stashes on
 * row._bindingElements).
 */
export function applyRowText(spec, els, item, row) {
    const emitters = spec.emitters;
    for (let j = 0; j < emitters.length; j++) {
        const e = emitters[j];
        const prop = e.reads[0];
        // Create-time: direct assign (the cloned row's target text is empty).
        if (e.kind === 'rootText') row.textContent = __wf_str(item[prop]);
        else { const el = els[e.elementIndex]; if (el) el.textContent = __wf_str(item[prop]); }
    }
}

/**
 * Apply one row's text for a changed prop (or every text binding when changedKey
 * is null/__ALL__, the full-row rebind). Uses the no-op-skip writer (update
 * semantics), unlike the create path's direct assign.
 */
export function applyRowTextUpdate(spec, els, item, row, changedKey) {
    const emitters = spec.emitters;
    const all = changedKey == null || changedKey === '__ALL__';
    for (let j = 0; j < emitters.length; j++) {
        const e = emitters[j];
        const prop = e.reads[0];
        if (!all && prop !== changedKey) continue;
        if (e.kind === 'rootText') {
            __wf_txt(row, __wf_str(item[prop]));
        } else {
            const el = els[e.elementIndex];
            if (el) __wf_txt(el, __wf_str(item[prop]));
        }
    }
}

/**
 * Text spec for MIXED templates (hybrid one-sink): emitters for only the
 * text-exclusive leaves (a _computeReactiveGraphPureText map of
 * field -> binding-element index), so applyRowTextUpdate / the dispatcher
 * can own those fields while every other binding kind stays on the per-row
 * effect. Root text never qualifies as pure (the classifier excludes it).
 */
export function getPureTextSpec(pureTextMap) {
    const emitters = [];
    for (const [field, idx] of pureTextMap) {
        emitters.push({ kind: 'text', elementIndex: idx, reads: [field] });
    }
    return emitters.length ? { emitters, rootProp: null } : null;
}

/**
 * Per-list dispatcher that replaces the per-row update effect for retire-eligible
 * templates. `rows` maps each raw item object to its row element; notifyNode
 * calls `sink(rawItem, changedKey)` for any leaf stamped via setListSink. Detached
 * rows (removed/replaced) are skipped via isConnected.
 */
export function createListSinkDispatcher(spec, applyRow, stampProps) {
    const rows = new Map(); // rawItem -> rowEl
    const dispatcher = { rows, spec, stampProps: stampProps || null };
    // Default applier (pure-text templates): write only the changed text binding.
    // Class-bearing templates pass an applyRow that also re-applies class via the
    // existing _applyClassBindingsToRow under untrack. Element array resolution
    // mirrors the renderer's convention: bulk-created rows carry the
    // metadata-ordered array on _bindingElements, per-row-bound rows on
    // _cachedElementsArray; read whichever exists.
    const apply = applyRow || ((rowEl, rawItem, key) => {
        applyRowTextUpdate(spec, rowEl._cachedElementsArray || rowEl._bindingElements, rawItem, rowEl, key);
    });
    dispatcher.sink = (rawItem, key) => {
        const rowEl = rows.get(rawItem);
        if (!rowEl || !rowEl.isConnected) return;
        apply(rowEl, rawItem, key);
    };
    return dispatcher;
}

/**
 * Dev-only identity oracle: rebuild one row through the generic text loop and
 * assert it is structurally equal to the compiled row. On mismatch, log and
 * disable the compiled path for this template (the generic path then takes over
 * for subsequent creates). Stripped from production builds.
 *
 * @param resolveEls (row) => Element[]  the caller's _buildElementsArrayFromMetadata bound to this template
 */
export function shadowCompareRow(md, compiledRow, item, proto, resolveEls) {
    const genRow = proto.cloneNode(true);
    const els = resolveEls(genRow);
    const bindings = md.bindings || [];
    for (let j = 0; j < bindings.length; j++) {
        const b = bindings[j];
        const el = els[b.index];
        if (el) el.textContent = __wf_str(item[b.path]);
    }
    if (md.rootBindings && md.rootBindings.hasBind && md.rootBindings.bindPath) {
        genRow.textContent = __wf_str(item[md.rootBindings.bindPath]);
    }
    if (!compiledRow.isEqualNode(genRow)) {
        // eslint-disable-next-line no-console
        console.error('[WildflowerJS] RowCompiler shadow-compare mismatch; disabling compiled row path for this template.', { compiled: compiledRow.outerHTML, generic: genRow.outerHTML });
        md._rowCompileDisabled = true;
        return false;
    }
    return true;
}
