# React Framework Reference
> Distilled from React docs + Zustand docs — update this section when APIs change.

React is a component-based UI library using a virtual DOM and declarative rendering. State management is provided by Zustand (lightweight external store).

## Zustand Store Pattern

```javascript
import { create } from 'zustand';

const useStore = create((set, get) => ({
    count: 0,
    items: [],

    // Methods that modify state — use set()
    increment: () => set((state) => ({ count: state.count + 1 })),
    addItem: (item) => set((state) => ({ items: [...state.items, item] })),

    // Read-only methods — use get() WITHOUT set()
    getItem: (id) => get().items.find(i => i.id === id),
    getTotal: () => get().items.reduce((sum, i) => sum + i.price, 0),
}));
```

**Critical rules:**
- Methods that **modify state** use `set((state) => ({ ...partial }))` — returns partial state to merge
- **Read-only methods** (getters, lookups, calculations) use `get()` — do NOT wrap reads in `set()`
- **Immutable updates**: spread arrays/objects (`[...state.items, item]`), never mutate in place
- Access store in components: `const count = useStore(state => state.count)`

## React Hooks

```javascript
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
```

- **`useMemo(() => expr, [deps])`** — cached computation. Recalculates only when deps change.
- **`useEffect(() => { ... return cleanup; }, [deps])`** — side effect with cleanup. Empty deps = mount only.
- **`useRef(initial)`** — mutable ref that persists across renders. Use for DOM refs, Chart.js instances.
- **`useCallback(fn, [deps])`** — memoized callback. Use sparingly — only when passing to memoized children.

## Component Pattern

```jsx
function MyComponent() {
    const count = useStore(state => state.count);
    const doubled = useMemo(() => count * 2, [count]);
    const chartRef = useRef(null);

    useEffect(() => {
        // Side effect on mount or when deps change
        return () => { /* cleanup */ };
    }, []);

    return <div>{doubled}</div>;
}
```

## Navigation Injection (for stores)

Stores can't use React hooks directly. Inject `navigate` from the component:

```javascript
// In store
const useUiStore = create((set, get) => ({
    _navigate: null,
    setNavigate: (fn) => set({ _navigate: fn }),
    goToPage: (path) => { get()._navigate(path); },
}));

// In App component
const navigate = useNavigate();
useEffect(() => { useUiStore.getState().setNavigate(navigate); }, [navigate]);
```

## Chart.js / Third-Party Integration

```jsx
function ChartWidget({ data }) {
    const chartRef = useRef(null);
    const chartInstance = useRef(null);

    useEffect(() => {
        chartInstance.current = new Chart(chartRef.current, config);
        return () => chartInstance.current?.destroy();
    }, []);

    useEffect(() => {
        if (chartInstance.current) {
            chartInstance.current.data.datasets[0].data = data;
            chartInstance.current.update('none');
        }
    }, [data]);

    return <canvas ref={chartRef} />;
}
```

## Conditional & List Rendering

```jsx
// Conditional
{condition && <Component />}
{condition ? <A /> : <B />}

// List
{items.map(item => <Item key={item.id} item={item} />)}
```

---

# UAM → React Idiom Guide

## References
- React: https://react.dev/llms.txt
- Zustand: https://docs.pmnd.rs/zustand
- React Router: https://reactrouter.com/

## Store Translation

- UAM stores → Zustand stores (one `create()` per UAM store)
- **Static stores** (`"static": true`): use a plain `const` array/object, NOT a Zustand store. No reactivity needed.
- Store methods take **named parameters directly** (e.g., `addItem(product)` not `addItem(args)`)
- Methods that **modify state** use `set((state) => { ...; return { key: newValue }; })`
- **Read-only methods** (getters, lookups) use `get()` without `set()` — do NOT wrap reads in `set()`
- Immutable updates: spread arrays/objects (`[...state.items, newItem]`), never mutate in place

## Computed Properties

- **Expensive** (`"expensive": true`): export selector functions + wrap with `useMemo` in components:
  ```js
  // In store file
  export const selectFiltered = (state) => state.items.filter(...);
  // In component
  const filtered = useMemo(() => selectFiltered(useStore.getState()), [deps]);
  ```
- **Cheap** (`"expensive": false` or omitted): inline access — `store.items.length`, no memoization
- Computed-to-computed chains: include intermediate values in `useMemo` dependency arrays

## Routing

- Use React Router v6 (`BrowserRouter`, `Routes`, `Route`)
- **Each UAM view = its own route component** — do NOT hide/show with state
- Filter/search state → URL query params via `useSearchParams`, not store state
- Navigation in store methods: inject `navigate` from component via `setNavigate()` pattern
- Named route params: `useParams()` for `:id` segments

## Component Architecture

- **Decompose**: one component per concern (Header, FilterBar, ProductGrid, ProductCard, CartDrawer, CheckoutForm, Confirmation)
- Do NOT put all views in one monolithic component
- Event handlers: `onClick={() => addItem(product)}` — pass data directly, not wrapped objects
- Conditional rendering: ternary expressions or `&&` — no show/hide CSS state

## Form Validation

- Extract as custom hook: `useFormValidation(rules)` returning `{ values, errors, touched, handleChange, handleBlur, isValid }`
- Validation rules map field names → rule objects (required, minLength, pattern, etc.)
- Show errors only for touched fields
- Validate all on submit, show first error per field

## Refs (Non-Reactive Instance Storage)
- UAM `refs` → `useRef(null)` in components
- For Zustand stores: plain variable in module scope or store state (not rendered)
- `chartRef.current = new Chart(...)` — mutable, no re-render
- Example:
  ```jsx
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  useEffect(() => {
      chartInstance.current = new Chart(chartRef.current, config);
      return () => chartInstance.current?.destroy();
  }, []);
  ```

## Deep Reactivity
- React does NOT have deep reactivity — ALWAYS use immutable patterns
- `set((state) => ({ items: [...state.items, newItem] }))` — spread arrays
- `set((state) => ({ items: state.items.map(i => i.id === id ? {...i, name} : i) }))` — spread objects
- Never mutate in place: `state.items.push(x)` will NOT trigger re-render

## Store Lifecycle
- `watch`: use `useStore.subscribe(selector, callback)` (Zustand subscribe API)
- `destroy`: no built-in Zustand cleanup — use module-level cleanup functions
- Cross-store effects: wire in `App.jsx` with `useEffect` watching one store and calling another

## Project Structure (Vite)

```
src/
├── App.jsx           # Root component with Routes + cross-store effects
├── main.jsx          # Entry point with BrowserRouter
├── stores/           # One file per Zustand store
│   ├── useCartStore.js
│   ├── useUiStore.js
│   └── ...
├── components/       # Decomposed UI components
│   ├── Header.jsx
│   ├── ProductGrid.jsx
│   ├── CartDrawer.jsx
│   └── ...
└── index.css         # Styles
```
