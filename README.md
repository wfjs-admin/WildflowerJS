# WildflowerJS

[![npm version](https://img.shields.io/npm/v/wildflowerjs.svg)](https://www.npmjs.com/package/wildflowerjs)
[![license](https://img.shields.io/npm/l/wildflowerjs.svg)](https://github.com/wfjs-admin/WildflowerJS/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/wildflowerjs)](https://bundlephobia.com/package/wildflowerjs)
[![CI](https://github.com/wfjs-admin/WildflowerJS/actions/workflows/ci.yml/badge.svg)](https://github.com/wfjs-admin/WildflowerJS/actions/workflows/ci.yml)

A reactive JavaScript framework with no build step, no virtual DOM, just standard HTML, CSS, and JavaScript.

**[Documentation](https://wildflowerjs.com)** | **[Getting Started](https://wildflowerjs.com/getting-started/quickstart)** | **[Demos](https://wildflowerjs.com/demos)**

## Quick Start

### CDN / Script Tag

```html
<!DOCTYPE html>
<html>
<head>
    <script defer src="https://unpkg.com/wildflowerjs@1/dist/wildflower.min.js"></script>
</head>
<body>
    <div data-component="counter">
        <h1 data-bind="count"></h1>
        <button data-action="increment">+1</button>
    </div>

    <script>
        wildflower.component('counter', {
            state: { count: 0 },
            increment() {
                this.count++;
            }
        });
    </script>
</body>
</html>
```

### npm

```bash
npm install wildflowerjs
```
### CDN Links

```html
<!-- Mini (smallest: CRUD apps, forms, dashboards, no data-pools) -->
<script defer src="https://cdn.jsdelivr.net/npm/wildflowerjs@1/dist/wildflower.mini.min.js"></script>

<!-- Lite (smaller: no plugins, portals, transitions, or modals) -->
<script defer src="https://cdn.jsdelivr.net/npm/wildflowerjs@1/dist/wildflower.lite.min.js"></script>

<!-- Core (most applications) -->
<script defer src="https://cdn.jsdelivr.net/npm/wildflowerjs@1/dist/wildflower.min.js"></script>

<!-- SPA (core + router) -->
<script defer src="https://cdn.jsdelivr.net/npm/wildflowerjs@1/dist/wildflower.spa.min.js"></script>

<!-- Full (core + router + SSR) -->
<script defer src="https://cdn.jsdelivr.net/npm/wildflowerjs@1/dist/wildflower.full.min.js"></script>
```

Pin a specific version with `wildflowerjs@1.1.0`.


## Guiding Principles

- No build step
- No virtual DOM
- No mashups: 100% standards-compliant HTML, CSS, JS
- Robust and performant as major frameworks
- The ease-of-use of jQuery

## Features

- **Zero Build Step**: Drop a `<script>` tag and start building. No CLI, no compilation, no transpilation.
- **Verifiable Supply Chain**: Three SHA-512-pinned tarballs in the build path, no transitive deps, no `npm install`. See [PROVENANCE.md](./PROVENANCE.md).
- **No Virtual DOM**: Direct DOM manipulation for performance and simplicity.
- **Reactive State**: Automatic UI updates when state changes, with computed properties and dependency tracking.
- **Component System**: Declarative components with lifecycle hooks, props, and cross-component communication.
- **Store Management**: Global reactive stores for shared state across components.
- **Entity Pools**: Pull-based rendering for high-frequency DOM updates at 60fps. Game-ready.
- **List Rendering**: Efficient array rendering with keyed reconciliation.
- **Event Handling**: Declarative event binding with modifiers and form handling.
- **Conditional Rendering**: Show/hide and insert/remove elements based on state.
- **Client-Side Routing**: History and hash mode routing with guards and transitions.
- **Server-Side Rendering**: SSR support with hydration.
- **Web Component Bridge**: First-class integration with Shoelace, Web Awesome, Nord, Carbon, Fluent UI, and any other standards-compliant web component library.


## Core Concepts

### Components

Components are registered with `wildflower.component()` and automatically discovered via `data-component` attributes:

```javascript
wildflower.component('todo-app', {
    state: {
        items: [],
        newItem: ''
    },

    computed: {
        itemCount() {
            return this.items.length;
        }
    },

    addItem() {
        if (this.newItem.trim()) {
            this.items.push({
                text: this.newItem,
                done: false
            });
            this.newItem = '';
        }
    },

    init() {
        // Called after component is mounted and bindings are ready
    },

    destroy() {
        // Called when component is removed from DOM
    }
});
```

### Data Binding

Bind state to the DOM with `data-bind`:

```html
<span data-bind="username"></span>
<div data-bind="items.length"></div>
<img data-bind-attr="{ src: avatarUrl }">
<div data-bind-style="textStyle"></div>
<div data-bind-class="active ? 'highlight' : ''"></div>
```

### Event Handling

Handle events with `data-action`:

```html
<button data-action="save">Save</button>
<button data-action="click:save">Save</button>
<input data-action="input:search">
<form data-action="submit:handleSubmit">
```

### Two-Way Binding

Bind form inputs with `data-model`:

```html
<input type="text" data-model="username">
<textarea data-model="bio"></textarea>
<select data-model="country">
    <option value="us">United States</option>
    <option value="uk">United Kingdom</option>
</select>
<input type="checkbox" data-model="agreed">
```

### Lists

Render arrays with `data-list`:

```html
<ul data-list="items">
    <template>
        <li>
            <span data-bind="text"></span>
            <button data-action="removeItem">Remove</button>
        </li>
    </template>
</ul>
```

### Conditional Rendering

Show/hide elements with `data-show`, insert/remove with `data-render`:

```html
<div data-show="isLoggedIn">Welcome back!</div>
<div data-render="hasPermission">Admin Panel</div>
```

### Stores

Share state across components:

```javascript
wildflower.store('auth', {
    state: {
        user: null,
        token: null
    },

    login(credentials) {
        // ... authenticate
        this.user = userData;
        this.token = token;
    },

    logout() {
        this.user = null;
        this.token = null;
    }
});
```

Access stores from components via subscription:

```javascript
wildflower.component('user-badge', {
    subscribe: { auth: ['user'] },
    computed: {
        displayName() {
            return this.stores.auth.user?.name || 'Guest';
        }
    }
});
```

Or in HTML with the `$` accessor:

```html
<span data-bind="$auth.user.name"></span>
```

### Entity Pools

Render hundreds of DOM elements at 60fps with `data-pool`:

```html
<div data-component="particles" data-pool-fps="60">
    <div data-pool="sprites" data-key="id">
        <template>
            <div class="sprite" data-bind-style="{ left: x + 'px', top: y + 'px' }">
                <span data-bind="label"></span>
            </div>
        </template>
    </div>
</div>
```

```javascript
wildflower.component('particles', {
    state: { nextId: 1 },
    init() {
        this._pool = this.pool('sprites');
    },
    spawn() {
        this._pool.add({ id: this.nextId++, x: 0, y: 0, label: 'particle' });
    },
    tick(dt) {
        // Called every frame: update positions, remove dead entities
    }
});
```

Pools also support an optional `entity: { state, computed, methods }` block for per-entity defaults, derived values, and bound actions. See [entity-model](https://www.wildflowerjs.com/docs/entity-model) and [pool-api](https://www.wildflowerjs.com/docs/pool-api).

## Build Variants

| Variant | Includes | Use Case |
|---------|----------|----------|
| `wildflower.mini.min.js` | Core + Stores (no data-pools, plugins, portals, transitions, modals) | Smallest footprint (CRUD, forms, dashboards) |
| `wildflower.lite.min.js` | Core + Stores + data-pools (no plugins, portals, transitions, modals) | Minimal footprint with high-frequency entity rendering |
| `wildflower.min.js` | Core framework | Most applications |
| `wildflower.spa.min.js` | Core + Router | Single-page applications |
| `wildflower.full.min.js` | Core + Router + SSR | Full-stack applications |

Each variant is available in three formats:
- `.js`: Unminified (debugging)
- `.dev.js`: Minified with console output preserved
- `.min.js`: Production (minified, console stripped)

## Web Component Integration

No virtual DOM means web component libraries work out of the box. Web Awesome, Fluent UI, Nord Health, and others need zero configuration. Libraries with non-standard event names (like Shoelace and IBM Carbon) need a lightweight adapter:

```html
<script src="adapters/shoelace.js"></script>
```

See the [Component Libraries](https://wildflowerjs.com/docs/component-libraries) guide for details and live examples.

## Development

```bash
git clone https://github.com/wfjs-admin/WildflowerJS.git
cd wildflowerjs
npm install
npm run test:setup   # one-time: installs test browser
npm run build
npm test
```

## Browser Support

All modern browsers:
- Chrome / Edge (latest)
- Firefox (latest)
- Safari (latest)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Community

- [Documentation](https://wildflowerjs.com)
- [GitHub Discussions](https://github.com/wfjs-admin/WildflowerJS/discussions)
- [Issue Tracker](https://github.com/wfjs-admin/WildflowerJS/issues)

## License

[MIT](LICENSE)
