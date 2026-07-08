# UAM → Vue 3 Idiom Guide

## References
- Vue: https://vuejs.org/llms.txt
- Pinia: https://pinia.vuejs.org/
- Vue Router: https://router.vuejs.org/

## Store Translation

- UAM stores → Pinia stores (one `defineStore()` per UAM store)
- Use **Options API** style for stores: `state()`, `getters`, `actions`
- **Static stores** (`"static": true`): use a plain `const` outside Pinia. No reactive store needed.
- Related UI state can live in the same store (e.g., `cartOpen` in a ui store is fine)
- Direct mutations in actions: `this.items.push(item)` — Pinia allows direct state mutation
- Store methods take **named parameters** (e.g., `addItem(product)` not `addItem(args)`)
- Pinia store state is already reactive — do NOT use `storeVersion` counters or manual invalidation hacks

## Computed Properties

- UAM computed → Pinia `getters` (automatically cached by Vue's reactivity)
- **Expensive** (`"expensive": true`): still use getters, but note in comments for profiling
- **Cheap**: getters or inline access — Vue's reactivity handles caching either way
- In components: `computed(() => store.someGetter)` or use `storeToRefs()` for template access
- Getter-to-getter chains: reference via `this.otherGetter` within Pinia store
- When a computed references another store's state (e.g., `computed(() => salesStore.totalRevenue)`), Vue's reactivity tracks the dependency automatically — no `watch` or `$subscribe` needed

## Cross-Store Reactivity

UAM `subscribe` + `onStoreUpdate` → Vue `watch()` in the app orchestrator component.

**Pattern**: The activity store exposes handler actions; the app component sets up watches that call those actions when other stores change.

```
// stores/activity.js — handler actions (no direct store imports needed)
actions: {
    handleCpuSpike(cpuLoad) {
        this.events = [{ id: Date.now(), type: 'alert', text: 'CPU spike: ' + Math.round(cpuLoad) + '%', time: 'Just now' }, ...this.events.slice(0, 9)];
    },
    handleNewOrder(order) {
        this.events = [{ id: Date.now(), type: 'sale', text: 'New order #' + order.id + ' - $' + order.amount.toLocaleString() + '.00', time: 'Just now' }, ...this.events.slice(0, 9)];
    }
}
```

```
// DashboardApp.vue — orchestrator sets up cross-store watches
onMounted(() => {
    watch(() => serverStore.cpuLoad, (newVal) => {
        if (newVal > 85) activityStore.handleCpuSpike(newVal);
    });
    watch(() => salesStore.lastNewOrder, (newVal) => {
        if (newVal) activityStore.handleNewOrder(newVal);
    });
});
```

**Why this pattern?**
- Avoids circular imports between store files
- Keeps stores focused — each store manages its own state
- Cross-store wiring is visible in one place (the orchestrator)
- Vue's `watch()` is the idiomatic way to react to state changes with side effects

## Routing

- Use Vue Router 4 with `createRouter()` and `createWebHistory()`
- **Each UAM view = its own route component** (`.vue` SFC or render function)
- Filter/search state → `route.query` via `useRoute()`, update with `router.push({ query: ... })`
- Route params: `route.params.id` for dynamic segments
- Named routes: `router.push({ name: 'product-detail', params: { id } })`

## Component Architecture

- **Composition API** (`<script setup>`) for all components
- Decompose into focused SFCs: AppHeader, FilterBar, ProductGrid, ProductCard, CartDrawer, CheckoutForm, ConfirmationView
- Do NOT build one monolithic App.vue with show/hide logic for every view
- Template directives: `v-for` for lists, `v-if`/`v-else` for conditionals, `v-model` for forms
- Event binding in loops: `@click="handler(item)"` — pass list item directly
- Only import stores the component actually uses — do NOT import every store into every component

## Props-Based Widget Pattern

When a component accepts a `storeName` prop and needs to access that store dynamically:
```
const storeMap = { sales: useSalesStore, users: useUsersStore };
const store = computed(() => storeMap[props.storeName]?.());
```
Then access `store.value.someProperty` in computed/template. Vue's reactivity tracks through `computed` automatically.

## Form Validation

- `reactive()` for touched state, `computed()` for error messages
- Validate on blur (mark touched) and re-validate reactively on input
- Show errors only for touched fields: `v-if="touched.email && errors.email"`
- Validate all fields on submit, prevent if any errors
- Class binding for invalid state: `:class="{ invalid: touched.field && errors.field }"`

## Refs (Non-Reactive Instance Storage)
- UAM `refs` → `shallowRef(null)` or `let` variable in `<script setup>`
- `shallowRef` prevents Vue from deep-proxying library instances
- Clean up in `onUnmounted()`: `chartRef.value?.destroy()`
- Example:
  ```
  const chart = shallowRef(null);
  onMounted(() => { chart.value = new Chart(canvas, config); });
  onUnmounted(() => { chart.value?.destroy(); });
  ```

## Deep Reactivity
- Vue has deep reactivity — nested mutations propagate automatically
- `item.name = 'new'` inside a Pinia action triggers reactive updates
- No immutable patterns needed (unlike React)

## Store Lifecycle
- `watch`: Pinia stores can use `$subscribe()` or Vue `watch()` in setup
- `destroy`: Use `$dispose()` or manual cleanup in the store's `$subscribe` handler
- Cross-store reactivity: use `watch()` in an orchestrator component (see Cross-Store Reactivity section above)

## Code Quality

- Action parameters: use named params (`simulateUpdate()` not `simulateUpdate(args)`)
- Component methods: plain functions, no `(event, element, details)` boilerplate unless handling DOM events
- Format code for readability — multi-line methods, proper indentation
- Clean up unused store imports in components
