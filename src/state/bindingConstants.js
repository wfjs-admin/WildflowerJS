/**
 * bindingConstants - Core-neutral symbols shared by the rendering layer.
 *
 * These are not tied to any particular reactive core: the rendering layer
 * (ListRenderer) needs DIRECT_WRITERS regardless of the underlying core.
 *
 * @module
 */

// Direct-writer map stamped on an array-item target by the list binder for
// single-bound text fields (singleTextProp): { propName: boundElement }. Lets a
// core's array-item SET path write the bound node directly and skip the
// bulk-array batch machinery.
export const DIRECT_WRITERS = Symbol('directWriters');
