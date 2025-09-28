# @purpleduck/bun-plugin-solid

A Bun plugin that enables Solid.js support with hot reloading.

## Usage

In your `bunfig.toml` or build configuration, use the plugin:

```toml
[serve.static]
plugins = ["@purpleduck/bun-plugin-solid"]
```

## Options

- `generate`: "dom" | "ssr" (default: "dom")
- `hydratable`: boolean (default: false)
- `hot`: boolean (default: true in development)

## Credits

This plugin is inspired by:

- [solid-refresh](https://github.com/solidjs/solid-refresh) for hot reloading functionality
- [vite-plugin-solid](https://github.com/solidjs/vite-plugin-solid) for the plugin architecture
