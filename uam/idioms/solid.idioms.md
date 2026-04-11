# Solid.js Framework Reference
> Distilled from Solid docs — update this section when Solid APIs change.

Solid.js is a reactive JavaScript framework with fine-grained reactivity and no virtual DOM. Components are plain functions that run once; only reactive expressions re-execute.

## Reactive Primitives

```javascript
import { createSignal, createMemo, createEffect, createRoot, onMount, onCleanup, batch } from "solid-js";
import { createStore, produce } from "solid-js/store";
```

- **`createSignal(initial)`** — reactive primitive value. Returns `[getter, setter]`. Use for strings, numbers, booleans.
- **`createStore(initialObj)`** — reactive object/array. Returns `[store, setStore]`. Use for objects, arrays, nested data.
- **`produce(fn)`** — Immer-like in-place mutation for stores: `setStore(produce(s => { s.items.push(item); }))`
- **Path-based updates** — `setStore("key", newValue)` or `setStore("items", i => i.filter(...))` for targeted updates.

## Derived & Side Effects

- **`createMemo(() => expr)`** — cached derived value. Re-runs only when dependencies change. Returns a getter function.
- **`createEffect(() => { ... })`** — reactive side effect. Re-runs when any accessed signal/store changes. Use for cross-store subscriptions, DOM side effects, logging.
- **`onMount(() => { ... })`** — runs once after component is mounted to DOM. Use for Chart.js init, timers, fetch calls.
- **`onCleanup(() => { ... })`** — cleanup callback. Runs when owner scope is disposed. Use for `clearInterval`, removing event listeners.

## Control Flow Components

```javascript
// JSX / build-step projects:
import { For, Show, Switch, Match } from "solid-js";

// CDN / html tagged templates:
import { render, For } from "solid-js/web";
// Note: Show, Switch, Match do NOT work with html tagged templates.
// Use ternary expressions instead (see CDN patterns below).
```

- **`<For each={list()}>{(item, index) => ...}</For>`** — keyed list rendering (JSX). For `html` tagged templates, see CDN patterns below.
- **`<Show when={condition()} fallback={...}>...</Show>`** — conditional rendering (JSX only). For `html` tagged templates, use ternary expressions.
- **`<Switch>/<Match>`** — multi-branch conditional rendering (JSX only).

## CDN / No-Build-Step Patterns

```javascript
import { createSignal, createMemo, createEffect, createRoot, onMount, onCleanup, batch } from "https://esm.sh/solid-js@1.9.5";
import { createStore, produce } from "https://esm.sh/solid-js@1.9.5/store";
import html from "https://esm.sh/solid-js@1.9.5/html";
import { render, For } from "https://esm.sh/solid-js@1.9.5/web";
```

**Critical**: In CDN/no-build-step mode with `html` tagged templates, `Show`, `Switch`, and `Match` do NOT work — they silently fail, rendering `>` characters as text. Only `For` works as a component. Use **ternary expressions** for all conditionals.

- Use `html` tagged template literal instead of JSX (no build step needed).
- Component references in html: `` html`<${ComponentName} prop=${value} />` ``
- List rendering — use `each` with an accessor function, close with `<//>`:
  ```javascript
  html`<${For} each=${() => items()}>
    ${(item) => html`<div>${item.name}</div>`}
  <//>`
  ```
- Conditional (if/else) — use ternary inside a reactive expression:
  ```javascript
  html`${() => isOpen() ? html`<div>visible</div>` : ""}`
  ```
- Multi-branch conditional — chain ternary expressions:
  ```javascript
  html`
    ${() => view() === "grid" ? html`<${GridView} />` : ""}
    ${() => view() === "detail" ? html`<${DetailView} />` : ""}
    ${() => view() === "checkout" ? html`<${CheckoutView} />` : ""}
  `
  ```
- Render: `render(() => html\`<\${App} />\`, document.getElementById("app"))`

## Component Pattern

Components are plain functions — no classes, no lifecycle object. All state, effects, and memos are declared inside the function body.

```javascript
function MyComponent(props) {
    const [count, setCount] = createSignal(0);
    const doubled = createMemo(() => count() * 2);

    onMount(() => { /* DOM ready */ });
    onCleanup(() => { /* dispose */ });

    return html`<div>${doubled}</div>`;
}
```

## Anti-Patterns to Avoid

1. **Never destructure or eagerly assign props.** `const { x } = props` or `const x = props.x` evaluates once at component creation and breaks reactivity. Always access `props.x` directly in templates and reactive expressions.
   ```javascript
   // BAD — loses reactivity
   function Kpi({ title, value }) { ... }
   function Kpi(props) { const title = props.title; ... }

   // GOOD — reactive access
   function Kpi(props) { return html`<div>${() => props.title}</div>`; }
   ```

2. **In JSX (build-step), never use ternaries for conditional rendering** — use `<Show>` for if/else and `<Switch>`/`<Match>` for multi-branch. **In `html` tagged templates (CDN), ternaries ARE the correct pattern** since `Show`/`Switch`/`Match` don't work:
   ```javascript
   // JSX (build-step) — use Show
   <Show when={isOpen()}><Drawer /></Show>

   // html tagged template (CDN) — use ternary
   html`${() => isOpen() ? html`<${Drawer} />` : ""}`
   ```

3. **Never do imperative DOM manipulation.** No `querySelector` + manual `style`/`class`/`innerHTML`. Use reactive bindings in templates instead. The only exception is third-party library targets (e.g., Chart.js canvas, SVG `innerHTML` for sparklines where Solid's html template can't produce SVG path elements).
   ```javascript
   // BAD — imperative style update
   const bar = el.querySelector('.cpu-bar');
   bar.style.width = cpu + '%';
   bar.className = 'progress-fill ' + statusClass;

   // GOOD — reactive template bindings
   html`<div class=${() => 'progress-fill ' + statusClass()}
             style=${() => ({ width: cpu() + '%' })} />`
   ```

4. **Never use `setTimeout`/`requestAnimationFrame` inside `createEffect`.** Solid's reactivity is synchronous — effects run immediately when dependencies change. Call library update functions directly. Use `onMount` + `setTimeout` only for initial DOM measurement when the element hasn't been laid out yet.
   ```javascript
   // BAD
   createEffect(() => { const d = store.data; setTimeout(() => chart.update(), 0); });

   // GOOD
   createEffect(() => { chart.data.datasets[0].data = [...store.data]; chart.update("none"); });
   ```

5. **Module-level `createEffect` must be wrapped in `createRoot`.** Effects outside a component have no owner scope and will leak. Wrap them in `createRoot` for proper disposal.
   ```javascript
   // BAD — leaks, no owner
   createEffect(() => { if (server.cpuLoad > 85) addAlert(...); });

   // GOOD — proper owner scope
   createRoot(() => {
     createEffect(() => { if (server.cpuLoad > 85) addAlert(...); });
   });
   ```

## Cross-Store Reactivity

Use `createEffect` to watch one store and update another. **When at module scope (outside a component), wrap in `createRoot`:**

```javascript
// Inside a component — has an owner, no wrapper needed
createEffect(() => {
    const cpu = serverStore.cpuLoad;
    if (cpu > 85) addActivity({ type: 'alert', text: 'CPU spike: ' + Math.round(cpu) + '%' });
});

// At module scope — MUST wrap in createRoot
import { createRoot } from "solid-js";

createRoot(() => {
    createEffect(() => {
        const cpu = serverStore.cpuLoad;
        if (cpu > 85) addActivity({ type: 'alert', text: 'CPU spike: ' + Math.round(cpu) + '%' });
    });
});
```

Effects automatically track all signal/store reads inside them — no dependency arrays needed.

### Avoiding Reactive Cycles in Effects

If a function called from `createEffect` both **reads and writes** the same store, Solid tracks the read as a dependency — the effect re-runs when it writes, causing infinite recursion. Use `produce()` so the mutation goes through a draft object (not the reactive proxy):

```javascript
// BAD — reads activityState.events inside effect context → infinite loop
function addActivity(event) {
    setActivity("events", [event, ...activityState.events.slice(0, 9)]);
}

// GOOD — produce draft is not reactive, breaks the tracking cycle
function addActivity(event) {
    setActivity(produce(s => {
        s.events.unshift(event);
        if (s.events.length > 10) s.events.length = 10;
    }));
}
```

---

# UAM → Solid.js Idiom Guide

## References
- Solid: https://docs.solidjs.com/llms.txt
- Solid Store: https://docs.solidjs.com/reference/store-utilities/create-store

## Store Translation

- UAM stores with object/array state → `createStore()` + `produce()` for mutations
- UAM stores with primitive state → `createSignal()` (e.g., `cartOpen`, `searchQuery`)
- **Static stores** (`"static": true`): use a plain `const` array/object. No signals/stores needed.
- Store methods are **plain functions** that call the setter — NOT methods on a class
- Methods take **named parameters directly** (e.g., `addItem(product)` not `addItem(args)`)
- Mutations via `produce()`: `setStore(produce(s => { s.items.push(item); }))` for in-place mutation
- Path-based updates: `setStore("items", store.items.filter(...))` for replacements

### Mutation Pattern Consistency

**Pick one mutation pattern per store and stick with it.** Prefer `produce()` for stores where methods do in-place mutations (push, splice, property assignment). Use path-based setters for stores where methods do full replacements (filter, map, assignment of new values). Don't mix `produce()` and path-based setters within the same store unless there's a clear reason.

## Computed Properties

- **Expensive** (`"expensive": true`): use `createMemo(() => ...)` — cached, recalculates only when dependencies change
- **Cheap** (`"expensive": false` or omitted): inline access in templates — `store.items.length`, no memo needed
- Derived signals that other code reads → `createMemo` regardless of cost (for caching)
- Memo-to-memo chains: reference other memos by calling them — `subtotal()` inside `total` memo

## Routing

For build-step projects: use `@solidjs/router`. For single-file CDN apps (no build step): manual routing with History API as shown below.

### CDN SPA Routing Pattern

```javascript
const BASE_PATH = "/demos/my-app"; // set to app's deploy path

function stripBase(pathname) {
  if (pathname.startsWith(BASE_PATH)) {
    const rest = pathname.slice(BASE_PATH.length);
    return rest || "/";
  }
  return pathname || "/";
}

function parseSearchParams() {
  const params = {};
  const search = window.location.search.slice(1);
  if (search) {
    search.split("&").forEach(pair => {
      const [key, val] = pair.split("=");
      if (key) params[decodeURIComponent(key)] = val ? decodeURIComponent(val) : "";
    });
  }
  return params;
}

// Reactive path & query param signals
const [currentPath, setCurrentPath] = createSignal(stripBase(window.location.pathname));
const [searchParams, setSearchParams] = createSignal(parseSearchParams());

// Navigate helper: pushState/replaceState + update signals
function navigate(path, options = {}) {
  const queryParts = [];
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== "") {
        queryParts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
      }
    }
  }
  const fullUrl = BASE_PATH + path + (queryParts.length ? "?" + queryParts.join("&") : "");
  if (options.replace) {
    history.replaceState(null, "", fullUrl);
  } else {
    history.pushState(null, "", fullUrl);
  }
  setCurrentPath(path);
  setSearchParams(parseSearchParams());
}

// Back/forward button support
window.addEventListener("popstate", () => {
  setCurrentPath(stripBase(window.location.pathname));
  setSearchParams(parseSearchParams());
});

// Derive current view from URL — createMemo for caching
const currentView = createMemo(() => {
  const path = currentPath();
  if (path.match(/^\/product\/\d+\/?$/)) return "detail";
  if (path === "/checkout" || path === "/checkout/") return "checkout";
  return "grid";
});

// Extract route params from URL
const selectedId = createMemo(() => {
  const match = currentPath().match(/^\/product\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
});
```

### Query Param Sync for Filters

When filters (category, search) should be reflected in the URL:

```javascript
// Update filter + URL together (replace: true to avoid history spam)
function setCategory(category) {
  setCategoryFilter(category);
  navigate("/", {
    query: {
      category: category === "all" ? undefined : category,
      search: searchQuery() || undefined
    },
    replace: true
  });
}

// Restore filter state from URL on back/forward (module-level: needs createRoot)
createRoot(() => {
  createEffect(() => {
    const params = searchParams();
    if (currentView() === "grid") {
      if (params.category !== undefined) setCategoryFilter(params.category || "all");
      if (params.search !== undefined) setSearchQuery(params.search || "");
    }
  });
});
```

### View Switching in Templates

Use ternary chains (not `Show`/`Switch`) keyed off the URL-derived `currentView` memo:

```javascript
html`
  ${() => currentView() === "grid" ? html`<${GridView} />` : ""}
  ${() => currentView() === "detail" ? html`<${DetailView} />` : ""}
  ${() => currentView() === "checkout" ? html`<${CheckoutView} />` : ""}
`
```

Navigation actions call `navigate` with paths, not signal setters:

```javascript
function showGrid() { navigate("/"); }
function showDetail(id) { navigate("/product/" + id); }
function showCheckout() { navigate("/checkout"); }
```

## Component Architecture

- **Decompose into component functions** — even without a build step, Solid components are just functions returning JSX/html
- Separate: App, Header, FilterBar, ProductGrid, ProductCard, ProductDetail, CartDrawer, CheckoutForm, ConfirmationView
- Do NOT put all views in one monolithic `App()` function
- Pass store accessors and actions as props or import from module scope
- Use `<For each={...}>` for list rendering (keyed by default)
- JSX: Use `<Show when={...}>` for conditional rendering. `html` tagged templates: use ternary expressions (see CDN patterns)

## Form Validation

- `createStore()` for touched state and error messages
- `createEffect()` for reactive re-validation when touched fields change
- Validate on blur: `onBlur={() => markTouched("field")}`
- Re-validate in effect: loop touched fields, run rules, update errors store
- Show errors conditionally: `touched.field && errors.field`
- Validate all on submit: mark all touched, check for any errors, prevent if invalid

## CDN / No-Build-Step Patterns

- Import from `esm.sh`: `import { createSignal } from "https://esm.sh/solid-js@1.9.5"`
- Use `html` tagged template literal from `solid-js/html` (no JSX without build step)
- `render(() => html\`<\${App} />\`, document.getElementById("app"))`
- Component references in html: `<\${ComponentName} prop=\${value} />`

### Table Elements — AVOID in `html` Tagged Templates

**Never use `<table>`, `<tr>`, `<td>`, `<th>`, `<thead>`, `<tbody>` in `html` tagged templates.** When `<tr>` is the root element of a template fragment (e.g., inside a `For` callback), the browser's HTML parser strips it, causing `null` element errors at runtime.

Instead, use **CSS Grid with divs** to create table-like layouts:

```javascript
html`
  <div class="data-table">
    <div class="table-header">Name</div>
    <div class="table-header">Email</div>
    <${For} each=${() => rows()}>${(row) => html`
      <div class="table-row">
        <div class="table-cell">${() => row.name}</div>
        <div class="table-cell">${() => row.email}</div>
      </div>
    `}<//>

  </div>
`
```

```css
.data-table { display: grid; grid-template-columns: 1fr 1fr; }
.table-row  { display: contents; }
```

The `display: contents` on rows lets cells participate directly in the parent grid.

### Inline Styles — Prefer Strings Over Objects in `html` Tagged Templates

Style objects (`style=${() => ({ backgroundColor: color() })}`) work in `html` tagged templates for properties with **no competing CSS shorthand** in the stylesheet. However, they may **not reliably override CSS shorthand properties** — e.g., an inline `backgroundColor` may fail to override a stylesheet's `background: #ebecf0`.

**Use CSS string format instead** for reliability:

```javascript
// GOOD — string style always works
style=${() => "background-color:" + color()}

// RISKY — may not override CSS `background: ...` shorthand
style=${() => ({ backgroundColor: color() })}

// SAFE — no competing CSS shorthand for `color`
style=${() => ({ color: textColor() })}
```

When the stylesheet uses CSS shorthands (`background`, `border`, `margin`, `padding`, `font`, etc.), always use a style string for the corresponding longhand inline overrides. Alternatively, remove the competing shorthand from CSS and set it entirely via inline style.

## Refs (Non-Reactive Instance Storage)
- UAM `refs` → plain `let` variable in component/module scope
- `let chart;` — not reactive, not tracked by Solid
- Clean up in `onCleanup()`: `chart?.destroy()`
- Example:
  ```javascript
  let chart;
  onMount(() => { chart = new Chart(canvas, config); });
  onCleanup(() => { chart?.destroy(); });
  ```

## Deep Reactivity
- Solid has deep reactivity via `createStore` — path-based mutations propagate
- `setStore("items", idx, "name", newName)` — fine-grained path update
- `setStore(produce(s => { s.items.push(item); }))` — Immer-like mutation
- Direct nested property access on store proxy is tracked automatically

## Store Lifecycle
- `watch`: `createEffect(() => { /* reads tracked automatically */ })`
- `destroy`: `onCleanup(() => { chart?.destroy(); clearInterval(timer); })`
- Cross-store effects: `createEffect` in module scope that reads one store and writes another (see Cross-Store Reactivity section above)

## Third-Party Libraries (Chart.js, etc.)

- Use `onMount` for initialization: `onMount(() => { chart = new Chart(canvas, config); })`
- Use `onCleanup` for teardown: `onCleanup(() => { chart?.destroy(); })`
- Use `createEffect` to react to data changes: `createEffect(() => { chart.data.datasets[0].data = [...store.data]; chart.update("none"); })`
- Get canvas refs via callback ref: `` html`<canvas ref=${el => canvasRef = el} />` ``

### Reactive Bindings vs Imperative DOM

For any UI state that Solid can express in templates, **always use reactive template bindings** — never `querySelector` + manual style/class assignment. This includes:

- **Dynamic classes**: `class=${() => 'base ' + dynamicPart()}`
- **Dynamic styles**: `style=${() => "background-color:" + color()}` (prefer strings; see "Inline Styles" under CDN patterns for why)
- **Dynamic text**: `${() => value()}`
- **Conditional visibility**: JSX: `<Show when={...}>`. `html` tagged templates: `${() => visible() ? html\`...\` : ""}` or `style=${() => ({ display: visible() ? '' : 'none' })}`

The **only exception** is third-party libraries that need direct DOM access:
- **Chart.js**: needs a `<canvas>` element reference — use callback ref + `onMount`
- **SVG sparklines**: Solid's `html` tagged templates don't support SVG `<path>` elements well — use `innerHTML` on an `<svg>` element via callback ref
- **Sortable.js**: needs a container DOM element

Even for these, keep the imperative code isolated to `onMount`/`createEffect` and let everything else be reactive template bindings.
