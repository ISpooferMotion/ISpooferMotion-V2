# Scripts

This directory contains utility scripts for building, developing, and maintaining the ISpooferMotion project.

## `build-plugin.mjs`

Compiles the Luau plugin by resolving `#include` directives in `src-tauri/plugin/plugin.luau`, wrapping it in a `.rbxmx` XML structure, and saving the final output to `dist-plugin/ISpooferMotion.rbxmx`.

## `clear-dev-state.mjs`

Cleans up development state and caches (such as Tauri's webview data) before starting the development server to ensure a clean slate.
