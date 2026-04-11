# WildflowerJS Framework Reference
> Distilled from llms.txt — update this section when llms.txt changes.

WildflowerJS is a reactive JavaScript framework that uses standard HTML, CSS, and JavaScript without a build step or virtual DOM. Reactivity is driven by `data-*` attributes and direct DOM manipulation.

## Component Definition

```javascript
wildflower.component('component-name', {
    state: {
        property: 'value',
        items: [],
        nested: { data: true }
    },

    computed: {
        derivedValue() {
            return this.state.property.toUpperCase();
        }
    },

    props: {
        propName: { type: 'string' },                // string prop
        count:    { type: 'number', default: 0 }     // number prop with default
    },

    watch: {
        property(newVal, oldVal) { /* react to changes */ }
    },

    // Declarative store subscriptions (enables this.stores)
    subscribe: {
        'store-name': ['path1', 'path2']
    },

    // Lifecycle
    beforeInit() { /* after method binding, before DOM bindings */ },
    init() {
        console.log(this.element); // DOM element
        console.log(this.state);   // reactive state
        console.log(this.props);   // read-only props
    },
    destroy() { /* cleanup */ },
    onUpdate(changedPaths) { /* after any state change */ },
    onStoreUpdate(storeName, path, newValue, oldValue) { /* subscribed store changed */ },

    // Methods — top level, NOT in an actions/methods block
    myMethod() {
        this.state.property = 'new value';
    }
});
```

## Store Definition

Stores are global reactive singletons. Same structure as components but without a DOM element.

```javascript
wildflower.store('store-name', {
    state: { value: 0 },

    computed: {
        doubled() { return this.state.value * 2; }
    },

    // Methods at top level
    increment() {
        this.state.value++;
    },

    init() { /* runs once on creation */ }
});
```

## Store Access from Components

```javascript
wildflower.component('example', {
    subscribe: {
        'store-name': ['value']  // enables this.stores + onStoreUpdate
    },

    computed: {
        storeValue() {
            return this.stores['store-name'].state.value;
        }
    },

    doSomething() {
        this.stores['store-name'].increment();
    },

    onStoreUpdate(storeName, path, newValue, oldValue) {
        // fires when subscribed paths change
    }
});

// Alternative: one-off access
const store = wildflower.getStore('store-name');
store.increment();
```

**Dynamic store access in computed:** `wildflower.getStore(name)` inside computed properties has automatic dependency tracking — the component re-renders when the store changes, no subscribe callbacks needed.

## Store-to-Store Subscriptions

Stores can subscribe to other stores using the same `subscribe`/`onStoreUpdate` mechanism:

```javascript
wildflower.store('activity', {
    state: { events: [] },

    subscribe: {
        server: ['cpuLoad'],
        sales: ['lastNewOrder']
    },

    onStoreUpdate(storeName, path, newValue, oldValue) {
        if (storeName === 'server' && path === 'cpuLoad' && newValue > 85) {
            this.state.events.unshift({ type: 'alert', text: 'CPU spike: ' + Math.round(newValue) + '%' });
            if (this.state.events.length > 10) this.state.events.pop();
        }
    }
});
```

Re-entrancy is guarded — infinite loops are prevented.

## HTML Binding Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-component` | Define component root | `<div data-component="name">` |
| `data-bind` | Bind text content | `<span data-bind="property">` |
| `data-bind="computed:name"` | Bind to computed | `<span data-bind="computed:fullName">` |
| `data-bind-html` | Bind HTML content | `<div data-bind-html="markup">` |
| `data-bind-class` | Dynamic CSS classes | `<div data-bind-class="isActive ? 'active' : ''">` |
| `data-bind-style` | Dynamic inline styles | `<div data-bind-style="{ color: textColor }">` |
| `data-model` | Two-way form binding | `<input data-model="username">` |
| `data-action` | Event handler (click) | `<button data-action="onClick">` |
| `data-action="event:method"` | Specific event type | `<input data-action="input:onType">` |
| `data-action="method('arg')"` | Action with literal args | `<button data-action="setPriority('high')">` |
| `data-action="event:method('arg')"` | Event type + args | `<input data-action="input:search('users')">` |
| `data-show` | Toggle visibility (CSS) | `<div data-show="isVisible">` |
| `data-render` | Toggle in DOM | `<div data-render="shouldRender">` |
| `data-list` | Render array | `<ul data-list="items">` |
| `data-key` | List item key | `<ul data-list="items" data-key="id">` |
| `data-prop-*` | Pass single prop to child | `<div data-component="child" data-prop-user="currentUser">` |
| `data-props` | Pass multiple props (JSON) | `<div data-component="child" data-props='{"title":"Hello","count":5}'>` |
| `data-bind="props.x"` | Display a prop value | `<span data-bind="props.title">` |

The `computed:` prefix is optional — the framework falls back to computed when a path isn't found in state.

## List Template Pattern

```html
<ul data-list="items" data-key="id">
    <template>
        <li>
            <span data-bind="name"></span>
            <span data-bind="_index"></span>
            <button data-action="removeItem">Delete</button>
        </li>
    </template>
</ul>
```

Built-in list context variables: `_index`, `_length`, `_first`, `_last`.

Store-backed lists:
```html
<div data-list="external('storeName', 'items')">
    <template><div data-bind="name"></div></template>
</div>

<!-- Or via computed -->
<div data-list="computed:items">
    <template><div data-bind="name"></div></template>
</div>
```

## List Action Context

When `data-action` is inside a `data-list` template, the method receives list context:

```javascript
removeItem(event, element, details) {
    const item = details.item;     // the list item for this row
    const index = details.index;   // index in the array
    const parent = details.parent; // parent list context (nested lists)
    this.state.items = this.state.items.filter(i => i.id !== item.id);
}
```

## DOM Helpers (this.$el)

jQuery-like DOM operations scoped to the component. Events auto-cleaned on destroy.

```javascript
init() {
    this.$el('.message').addClass('highlight').css({ color: 'blue' }).text('Updated!');
    this.$el('.btn').on('click', () => this.state.count++);
    const rawEl = this.$el('.canvas').el;  // raw DOM element for third-party libs
}
```

Key methods: `.el`, `.find(sel)`, `.on(evt, fn)`, `.off(evt, fn)`, `.addClass(c)`, `.removeClass(c)`, `.toggleClass(c)`, `.css(k,v)`, `.val(v)`, `.text(v)`, `.html(v)`, `.show()`, `.hide()`, `.parent()`, `.children()`, `.closest(sel)`.

## Item-Level Computed Properties

Computed functions with parameters are evaluated per list item:

```javascript
computed: {
    // Component-level (no params) — evaluated once
    cartTotal() { return this.stores.cart.computed.total; },

    // Item-level (has params) — evaluated per list item
    priceWithTax(item) { return item.price * (1 + this.state.taxRate); },
    isInCart(item) { return this.computed.inCartQty(item) > 0; }
}
```

Template usage: `<span data-bind="computed:priceWithTax">` — the framework passes the list item automatically.

## Framework Loading

```html
<script defer src="/js/dist/wildflower.min.js"></script>
```

All code in `document.addEventListener('DOMContentLoaded', function() { ... })`.
Components are auto-discovered via `[data-component]` attributes.

---

# UAM → WildflowerJS Idiom Guide

## Framework Loading
- Single `<script>` tag: `<script defer src="/js/dist/wildflower.lite.min.js"></script>` (or `.spa.` for routing, `.ai.` for builder)
- All code in `document.addEventListener('DOMContentLoaded', function() { ... })`
- Components auto-discovered via `[data-component]` attributes in the HTML

## Page Setup Best Practices

### Script Loading
- Place **all scripts in `<head>`** with the `defer` attribute — this is ~50% faster First Contentful Paint than scripts at end of `<body>`
- `defer` guarantees execution order and runs after HTML is parsed
- Order: third-party CDN libs → framework → app code
```html
<head>
    <!-- Anti-FOUC CSS first -->
    <style>
        [data-cloak] { display: none; }
    </style>

    <!-- External styles -->
    <link rel="stylesheet" href="styles.css">

    <!-- Third-party libraries -->
    <script defer src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"></script>

    <!-- Framework -->
    <script defer src="/js/dist/wildflower.min.js"></script>

    <!-- App code (executes after framework due to defer order) -->
    <script defer src="app.js"></script>
</head>
```

### Anti-FOUC (Flash of Unstyled Content)
- Add `[data-cloak] { display: none; }` as inline CSS in `<head>` before any external CSS
- Add `data-cloak` attribute to elements that should be hidden until the framework processes them:
  - `data-show` elements whose initial condition is false
  - `data-portal` elements
  - `data-render` elements whose initial condition is false
- The framework removes all `data-cloak` attributes after initialization completes
- Elements with `style="display:none"` inline don't need `data-cloak` (already hidden)
- This is the same pattern used by Alpine.js (`x-cloak`) and petite-vue (`v-cloak`)

### External CSS and JS Files
- For production demos, split CSS and JS into separate files for maintainability
- CSS: `<link rel="stylesheet" href="styles.css">` in `<head>`
- JS: `<script defer src="app.js"></script>` in `<head>` (NOT at end of body)
- Production bundles: use `.min.js` variants for framework scripts

### HTML Template Structure
- Write the full HTML template directly in the document body — well-formatted and readable
- The root `data-component` wraps the entire application
- Use proper indentation — do NOT minify HTML onto a single line
- Comments for section boundaries: `<!-- Header -->`, `<!-- Card list -->`

## Component Architecture
- `wildflower.component(name, definition)` — register components
- State: `state: { key: value }` — reactive, drives DOM bindings automatically
- Methods at top level (NOT in an `actions` or `methods` block): `methodName() { ... }`
- Method signature: `methodName()` — do NOT add `(event, element, details)` boilerplate unless the method needs event/element info or uses action arguments (`details.args`)
- Methods called programmatically (e.g., from `init`, from other methods, from third-party callbacks) should use **named parameters**: `addDestination(lat, lng)` not `arguments[0]`
- Computed: `computed: { name() { return this.state.x; } }` — cached, auto-updates bindings
- Watch: `watch: { propertyName(newVal, oldVal) { ... } }` — reacts to state changes
- Lifecycle: `init()` runs after component mounts; `destroy()` runs on teardown
- `this.element` — the component's root DOM element

## Props — Passing Data to Child Components

### Defining Props
Props are declared as objects with `type` (and optional `default`). Plain values like `title: ''` are **invalid** — always use the object form:
```javascript
wildflower.component('kpi-widget', {
    props: {
        title:     { type: 'string' },
        storeName: { type: 'string' },
        valueKey:  { type: 'string' },
        format:    { type: 'string', default: 'number' },
        prefix:    { type: 'string', default: '' }
    },
    computed: {
        value() {
            var store = wildflower.getStore(this.props.storeName);
            if (!store) return 0;
            return store.state[this.props.valueKey];
        }
    }
});
```

### Passing Props in HTML — Static Values
For static string/number/boolean props, use the **JSON `data-props` attribute** (preferred for multiple props):
```html
<div data-component="kpi-widget"
     data-props='{"title":"Total Revenue","storeName":"sales","valueKey":"totalRevenue","format":"currency","prefix":"$"}'>
    <!-- component template -->
</div>
```
The JSON syntax automatically handles string quoting. All values are passed as literals.

Individual attributes work too, but string literals need **explicit quotes** inside the attribute value:
```html
<!-- ✅ CORRECT — inner quotes make it a literal string -->
<div data-component="child" data-prop-title="'Total Revenue'">

<!-- ❌ WRONG — without quotes, resolves from parent state (looks for state.Total Revenue) -->
<div data-component="child" data-prop-title="Total Revenue">
```

### Passing Props in HTML — Dynamic Values
Without quotes, the value resolves from **parent component state**:
```html
<!-- Passes parent's this.state.currentUser as child's this.props.user -->
<div data-component="user-card" data-prop-user="currentUser">
```

### Displaying Props in Templates
Use the `props.` prefix in `data-bind`:
```html
<div data-component="kpi-widget" data-props='{"title":"Total Revenue"}'>
    <div class="widget">
        <span data-bind="props.title"></span>          <!-- displays "Total Revenue" -->
        <span data-bind="computed:value"></span>        <!-- displays computed value -->
    </div>
</div>
```

### Prop Name Convention
Kebab-case attributes convert to camelCase props:
- `data-prop-store-name="'sales'"` → `this.props.storeName`
- `data-prop-value-key="'totalRevenue'"` → `this.props.valueKey`

The JSON `data-props` attribute uses camelCase directly: `data-props='{"storeName":"sales"}'`.

## WildQuery (`this.$el`) DOM API
- `this.$el(selector)` — scoped jQuery-like wrapper, boundary-enforced (can't escape the component's element)
- `.el` — raw DOM element (use for third-party library init: `flatpickr(this.$el('#date').el, opts)`)
- `.find(sel)` — scoped query within matched elements
- `.on(evt, fn)` / `.off(evt, fn)` — auto-tracked events, **automatically cleaned up on component destroy** (superior to raw `addEventListener` for third-party DOM event binding)
- `.addClass(c)`, `.removeClass(c)`, `.toggleClass(c)`, `.hasClass(c)` — class manipulation
- `.css(k, v)` or `.css({...})` — style get/set
- `.val(v)` — form value get/set (auto-syncs with `data-model`)
- `.text(v)`, `.html(v)` — content get/set
- `.show()`, `.hide()` — display toggle
- `.focus()`, `.trigger(evt)` — utility
- `.parent()`, `.children()`, `.siblings()`, `.closest(sel)` — traversal (boundary-enforced)

## When to Use Sub-Components
- Use sub-components when DOM is **dynamically injected by a third-party library** (e.g., Leaflet popups) and needs framework event handling
- Use sub-components when list items need **their own lifecycle** (init/destroy)
- Do NOT create sub-components just for organizational purposes — keep it flat when the parent can handle everything
- After injecting HTML containing `data-component`, call `wildflower.scan(containerSelector)` to initialize them

## Template / HTML
- Write HTML **directly in the document body**, well-formatted and readable
- Use `data-bind="propertyName"` or `data-bind="computed:propertyName"` for text content
- Use `data-action="methodName"` for click/event handlers
- Use `data-list="arrayProperty"` with `<template>` for reactive lists
- Use `data-show="condition"` for conditional visibility
- Use `data-model="property"` for two-way form binding
- Do NOT minify HTML onto a single line — readability matters

### Multiple Event Bindings on One Element
When an element needs handlers for different event types (e.g., `input` for live preview and `change` for commit), combine them in a **single space-separated `data-action` attribute**:
```html
<!-- ✅ CORRECT — space-separated in one attribute -->
<input type="color" data-action="input:updatePreview change:commitValue">

<!-- ❌ BROKEN — HTML silently discards duplicate attributes; the second is ignored -->
<input type="color" data-action="input:updatePreview" data-action="change:commitValue">
```
This is a standard HTML rule (not framework-specific): when two attributes share the same name, the browser keeps only the first and silently drops the second. The framework's `data-action` parser splits on spaces outside parentheses, so all bindings fit in one attribute value.

## State Design
- **Static data** (`"static": true`): still define in `state` but note it won't change (WF has no plain-const equivalent — everything goes through reactive state)
- **Third-party library instances** (maps, calendars, sortable): store as plain instance properties (`this._map`, `this._picker`), NOT in `state`. Only data that drives DOM bindings belongs in `state`.

### Mutation Reactivity — Direct Mutation over Spread
WildflowerJS has **deep reactive proxies** and an **ArrayOperationDetector** — direct mutations like `.push()`, `.splice()`, `.unshift()` enable **O(1) DOM updates** because the framework knows exactly what changed. Spread/slice patterns (`[...arr]`, `arr.slice()`) force the framework to treat the update as a full array replacement, triggering **O(n) reconciliation** of every list item in the DOM.

**Rule: Never use `[...]` or `{...}` for state updates unless you explicitly need to break a reference. Use `.push()`, `.unshift()`, `.splice()`, and direct property assignment to enable O(1) DOM path updates.**

```
// ✅ CORRECT — direct mutations, O(1) DOM updates
this.state.items.push(newItem);                          // append
this.state.items.unshift(newItem);                       // prepend
this.state.items.splice(index, 1);                       // remove at index
col.cards = col.cards.filter(c => c.id !== cardId);      // nested reassignment
col.name = 'Renamed';                                    // nested property assignment

// ✅ CORRECT — fixed-length list (e.g., activity feed, last 10 items)
this.state.events.unshift(newEvent);
if (this.state.events.length > 10) this.state.events.pop();

// ✅ CORRECT — sliding window (e.g., chart history)
this.state.history.shift();
this.state.history.push(newDataPoint);

// ❌ WRONG — spread forces O(n) reconciliation, bypasses ArrayOperationDetector
this.state.items = [...this.state.items, newItem];
this.state.events = [newEvent, ...this.state.events.slice(0, 9)];
this.state.history = [...this.state.history.slice(1), newDataPoint];
```
- Direct nested property assignments (`col.name = 'x'`) trigger reactivity
- Nested array reassignments (`col.cards = col.cards.filter(...)`) trigger reactivity
- Nested array mutations (`col.cards.push(item)`) trigger reactivity
- Top-level array mutations (`.push()`, `.unshift()`, `.splice()`) trigger reactivity via ArrayOperationDetector

## Syncing Component State → Store (form inputs)
- `data-model` always binds to the **component's own `state`**, not to a store
- If other entities (child components, other stores) need to react to a form input value, you must **explicitly sync** the component state to the store
- Use `watch` to bridge the gap:
  ```
  // Component owns the search input via data-model="searchQuery"
  state: { searchQuery: '' },
  watch: {
      searchQuery(newVal) {
          if (this.stores.myStore) this.stores.myStore.state.searchQuery = newVal;
      }
  }
  ```
- Alternative: use `data-action="input:onSearch"` instead of `data-model` and update both in the handler
- This applies whenever a parent component's form input drives filtering/behavior in child components that read from a shared store

## List Actions — `details.item` Pattern
- When `data-action` is inside a `data-list` template, the framework provides the list item automatically:
  ```
  toggleTask(event, element, details) {
      const task = details.item;  // the list item for this row
      task.done = !task.done;
  }
  ```
- No sub-components needed for interactive lists — `data-list` + `data-action` handles it

## Action Arguments — Passing Literals
When multiple buttons or elements perform the same action with different values, use argument passing instead of separate methods:

```html
<!-- ✅ CORRECT — one method, three buttons -->
<button data-action="setPriority('high')">High</button>
<button data-action="setPriority('medium')">Medium</button>
<button data-action="setPriority('low')">Low</button>
```
```javascript
setPriority(event, element, details) {
    this.state.priority = details.args[0];
}
```

```html
<!-- ❌ UNNECESSARY — do NOT create separate methods for each value -->
<button data-action="setPriorityHigh">High</button>
<button data-action="setPriorityMedium">Medium</button>
<button data-action="setPriorityLow">Low</button>
```

**Supported literal types:** strings (`'hello'`, `"hello"`), numbers (`42`, `0.5`, `-1`), booleans (`true`, `false`), `null`.

**Multiple arguments:** `data-action="configure('dark', 2, true)"` → `details.args = ['dark', 2, true]`

**Event type prefix:** `data-action="input:search('users')"` → input event, `details.args = ['users']`

**List context:** In list templates, `details.args` coexists with `details.item`, `details.index`, etc.:
```javascript
setStatus(event, element, details) {
    const task = details.item;       // list item for this row
    const status = details.args[0];  // 'done' or 'archived'
    task.status = status;
}
```

**Args also appended as extra parameters** after `(event, element, details)`:
```javascript
setPriority(event, element, details, priority) {
    // priority === details.args[0] === 'high'
    this.state.priority = priority;
}
```

## Array Reorder Pattern (SortableJS, drag-and-drop)
```
const item = this.state.items.splice(evt.oldIndex, 1)[0];
this.state.items.splice(evt.newIndex, 0, item);
```
Use the provided indices directly. Do NOT query DOM attributes to reconstruct order.

## Unified Entity Model
Components, stores, and plugins share the same reactive base (`state`, `computed`, `watch`, methods, lifecycle hooks). The difference is scope:
- **Components** (`wildflower.component()`) — bound to a DOM element, local scope
- **Stores** (`wildflower.store()`) — no DOM, global singleton. Methods at top level, same as components.
- **Plugins** (`wildflower.plugin()`) — framework-level, accessed via `wildflower.$pluginName`

## Refs (Non-Reactive Instance Storage)
- UAM `refs` → underscore-prefixed instance properties: `this._chart = null;`
- Initialize in `init()`: `this._chart = new Chart(this.$el('canvas').el, config);`
- Clean up in `destroy()`: `this._chart?.destroy(); this._chart = null;`
- Do NOT put library instances in `state` — they don't drive DOM bindings

### Store Lifecycle
- `watch`: same syntax as component watch — `watch: { property(newVal, oldVal) { ... } }`
- `destroy()`: cleanup when store is torn down (clearInterval, close connections)
- `subscribe` + `onStoreUpdate`: cross-store reactivity (already documented above)

### Store Access from Components
- **Template binding**: `data-bind="external('storeName', 'property')"` — bind store state in HTML
- **Declarative subscription**: `subscribe: { storeName: ['prop1', 'prop2'] }` — re-renders on changes
- **Direct access**: `this.stores.storeName.state.x` and `this.stores.storeName.methodName()`
- **Change hook**: `onStoreUpdate(storeName, path, newValue, oldValue)` — react to store changes

### Store-to-Store Subscriptions
Stores can subscribe to other stores using the same `subscribe`/`onStoreUpdate` mechanism as components:
```
wildflower.store('activity', {
    state: { events: [] },
    subscribe: { server: ['cpuLoad'] },
    onStoreUpdate(storeName, path, newValue, oldValue) {
        if (storeName === 'server' && path === 'cpuLoad' && newValue > 85) {
            this.state.events.unshift({ type: 'alert', text: 'CPU spike: ' + Math.round(newValue) + '%' });
            if (this.state.events.length > 10) this.state.events.pop();
        }
    }
});
```
- `subscribe` declares which store paths to watch — the framework wires up notifications automatically
- `onStoreUpdate` fires whenever a watched path changes, with both old and new values
- Re-entrancy is guarded: if `onStoreUpdate` modifies a store that another store watches, infinite loops are prevented

### Dynamic Store Access (props-based widgets)
- `wildflower.getStore(name)` inside **computed properties** has automatic cross-entity dependency tracking — the component re-renders when the store changes, no subscribe callbacks or hacks needed
- Do NOT use `storeVersion` counters or empty subscribe callbacks `() => {}` for computed reactivity — `getStore()` inside computed handles it automatically
- Use `store.subscribe(key, callback)` **only** for imperative side effects (e.g., updating a Chart.js instance, drawing SVG) that are outside the reactive binding system

## Reactive Lists vs innerHTML
- Prefer `data-list` with `<template>` for lists that are purely data-driven
- Use `innerHTML` + `wildflower.scan()` only when list items need to be full sub-components with their own lifecycle
- For simple lists where items just need click handlers, `data-list` + `data-action` is cleaner than innerHTML rebuilds

## Third-Party Library Integration
- WF has no virtual DOM — third-party libraries that manipulate real DOM work without conflict
- Init libraries in `init()`, destroy in `destroy()`
- Use `this.$el(selector).el` to get DOM elements for library initialization
- Store library instances as `this._libName`, not in `state`
- When a library creates DOM that should contain WF components, call `wildflower.scan(containerSelector)` after the DOM is created
- Watchers sync state → library: `watch: { data() { this.syncLibrary(); } }`
- **Deferred init**: When a library needs rendered dimensions (canvas size, element rect), use `requestAnimationFrame` instead of `setTimeout` magic numbers:
  ```
  init() {
      requestAnimationFrame(() => this.createChart());
  }
  ```

### Direct Mutations + Imperative Side Effects
When using `store.subscribe(key, callback)` alongside direct array mutations (`.push()`, `.shift()`, `.splice()`), two things happen that don't affect `data-list` bindings (which handle this internally) but DO affect imperative code:

**1. Reference identity** — Direct mutations keep the same array reference. Libraries that compare references to detect changes (Chart.js, D3, ApexCharts, DataTables, ECharts) will miss the update. Copy the data at the library boundary with `.slice()`:
```
// ✅ CORRECT — .slice() gives the library a new reference
updateChart() {
    var store = wildflower.getStore(this.props.storeName);
    this._chart.data.datasets[0].data = (store.state[this.props.dataKey] || []).slice();
    this._chart.data.labels = (store.state[this.props.labelsKey] || []).slice();
    this._chart.update('none');
}

// ❌ WRONG — same reference, library won't detect change
updateChart() {
    var store = wildflower.getStore(this.props.storeName);
    this._chart.data.datasets[0].data = store.state[this.props.dataKey] || [];
    this._chart.update('none');
}
```
Libraries that read values fresh and render directly (e.g., drawing SVG paths, writing to canvas) are unaffected — they always see current data.

**2. Notification coalescing** — The framework fires `store.subscribe()` callbacks exactly **once** per array mutation (`.push()`, `.shift()`, `.splice()`, etc.), not per index. No manual coalescing is needed — a simple subscribe is sufficient:
```
init() {
    var store = wildflower.getStore(this.props.storeName);
    store.subscribe(this.props.dataKey, () => this.updateChart());
    requestAnimationFrame(() => this.createChart());
}
```

## Long-Running Processes — Store Ownership
Data simulations, WebSocket connections, polling intervals, and other long-running processes belong in **Stores**, not components. Stores are global singletons that persist across navigation — if an interval lives in a component, navigating away destroys it and the data resets.

```
// ✅ CORRECT — simulation lives in the store, persists across navigation
wildflower.store('server', {
    state: { cpuLoad: 42 },
    simulateMetrics() {
        this.state.cpuLoad = Math.min(100, Math.max(5, this.state.cpuLoad + (Math.random() - 0.5) * 20));
    },
    init() {
        this._interval = setInterval(() => this.simulateMetrics(), 2000);
    },
    destroy() {
        clearInterval(this._interval);
    }
});

// ❌ FRAGILE — simulation lives in component, dies on navigate-away
wildflower.component('dashboard-app', {
    init() {
        this._timer = setInterval(() => wildflower.getStore('server').simulateMetrics(), 2000);
    },
    destroy() { clearInterval(this._timer); }
});
```

Components should **consume** store data and **trigger** store actions, not own the data lifecycle.

## Code Formatting
- Format JS/HTML for human readability — proper indentation, line breaks, comments
- CSS: keep rules compact (one rule per line, minimal blank lines). Reserve whitespace for JS/HTML.
- Group related methods together with section comments
- Keep `init()` concise — delegate to named helper methods like `initMap()`, `initCalendar()`
