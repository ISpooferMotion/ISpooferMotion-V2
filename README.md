<p align="center">
  <img src="./src/assets/app_icon.png" width="128" height="128" alt="ISpooferMotion">
</p>

<h1 align="center">ISpooferMotion V2</h1>

<p align="center">
  A desktop asset replacement tool for Roblox Studio.
  <br>
  Preview, replace, and push assets across an entire place without manually editing instances.
</p>

<p align="center">
  <kbd>Animations</kbd>&nbsp;&nbsp;
  <kbd>Sounds</kbd>&nbsp;&nbsp;
  <kbd>Decals</kbd>&nbsp;&nbsp;
  <kbd>Meshes</kbd>&nbsp;&nbsp;
  <kbd>Videos</kbd>
</p>

<p align="center">
  <sub>Tauri 2 · Rust · React 19 · Luau</sub>
</p>

<p align="center">
  <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/releases/latest">
    <img src="https://img.shields.io/github/v/release/ISpooferMotion/ISpooferMotion-V2?style=flat-square&label=release" alt="Latest Release">
  </a>
  &nbsp;
  <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/releases">
    <img src="https://img.shields.io/github/downloads/ISpooferMotion/ISpooferMotion-V2/total?style=flat-square&label=downloads" alt="Downloads">
  </a>
  &nbsp;
  <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/ISpooferMotion/ISpooferMotion-V2?style=flat-square&label=license" alt="License">
  </a>
</p>

<p align="center">
  <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/releases/latest">Download</a>
  ·
  <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/issues/new?template=bug_report.md">Report a Bug</a>
  ·
  <a href="https://github.com/ISpooferMotion/ISpooferMotion-V2/issues/new?template=feature_request.md">Request a Feature</a>
</p>

<br>

---

## Overview

ISpooferMotion connects directly to a running Roblox Studio session through a companion Luau plugin. Once connected, assets can be discovered, previewed, and replaced across the entire place without manually searching through instances or modifying place files.

<table>
  <tr>
    <td width="25%" valign="top">
      <strong>Asset replacement</strong><br><br>
      <sub>Replace animations, sounds, decals, meshes, and videos across a complete place scan in real time.</sub>
    </td>
    <td width="25%" valign="top">
      <strong>Asset preview</strong><br><br>
      <sub>Preview R6 and R15 animations and listen to audio assets before applying replacements.</sub>
    </td>
    <td width="25%" valign="top">
      <strong>Profiles</strong><br><br>
      <sub>Manage Roblox users and groups with isolated profile data and credentials stored through the operating system.</sub>
    </td>
    <td width="25%" valign="top">
      <strong>Place browser</strong><br><br>
      <sub>Explore the asset tree, inspect instance properties, locate references, and copy asset IDs directly.</sub>
    </td>
  </tr>
</table>

ISpooferMotion keeps the desktop application and Studio plugin synchronized so replacements can be applied while the place is running. The application handles discovery, previews, profiles, and replacement configuration while the plugin performs the Studio side operations.

---

## Installation

Download the latest release for your platform from the [releases page](https://github.com/ISpooferMotion/ISpooferMotion-V2/releases/latest).

| Platform | Package                               |
| -------- | ------------------------------------- |
| Windows  | `ISpooferMotion_x.x.x_x64-setup.exe`  |
| macOS    | `ISpooferMotion_x.x.x_x64.dmg`        |
| Linux    | `ISpooferMotion_x.x.x_amd64.AppImage` |

The Roblox Studio plugin, `ISpooferMotion.rbxmx`, is included with every release.

Install it by opening the file with Roblox Studio or adding it through **Plugins → Manage Plugins**.

> [!NOTE]
> Windows Defender and other antivirus software may flag unsigned builds. ISpooferMotion is not currently code signed. Builds can be independently verified by compiling the project from source.

---

## Development

### Requirements

| Requirement   | Version       |
| ------------- | ------------- |
| Rust          | Latest stable |
| Bun           | 1.x or newer  |
| Node.js       | 20 or newer   |
| Tauri         | 2.x           |
| Roblox Studio | Latest        |

Linux development also requires the native Tauri dependencies:

```bash
libwebkit2gtk-4.1-dev
libssl-dev
libayatana-appindicator3-dev
librsvg2-dev
```

### Run

```bash
git clone https://github.com/ISpooferMotion/ISpooferMotion-V2.git
cd ISpooferMotion-V2

bun install
bun run tauri:dev
```

<details>

<summary><strong>Useful commands</strong></summary>

<br>

| Command                | Description                                        |
| ---------------------- | -------------------------------------------------- |
| `bun run tauri:dev`    | Start the desktop application in development mode  |
| `bun run check`        | Run the complete project validation suite          |
| `bun run build:plugin` | Build the Roblox Studio plugin into `dist-plugin/` |
| `bun run format`       | Format TypeScript, Rust, and Luau sources          |
| `bun run test`         | Run frontend tests with Vitest                     |
| `bun run rust:test`    | Run Rust unit tests                                |

</details>

<details>

<summary><strong>Full validation</strong></summary>

<br>

Before opening a pull request, run:

```bash
bun run check
```

The check suite validates formatting, frontend types, linting, Rust code, tests, and production builds.

Individual checks can also be run through their respective package scripts when working on a specific part of the project.

</details>

---

## Project structure

The project is split between the desktop application and the Roblox Studio integration.

```text
ISpooferMotion-V2/
├── src/                 React frontend
├── src-tauri/           Tauri and Rust backend
├── plugin/              Roblox Studio Luau plugin
├── dist-plugin/         Built plugin output
├── public/              Static frontend assets
├── tests/               Project tests
└── .github/             CI, issue templates, and contribution files
```

<sub>Exact directories may vary as the project evolves.</sub>

---

## Contributing

Contributions are welcome.

Read [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) before opening a pull request.

Branch from `main`, keep changes focused, follow [Conventional Commits](https://www.conventionalcommits.org/), and verify the project before pushing:

```bash
bun run check
```

> [!IMPORTANT]
> Pull requests must pass the repository's automated checks before they can be merged.

---

## License

ISpooferMotion is licensed under the **GNU General Public License v3.0 or later**.

See [`LICENSE`](LICENSE) for the full license text.
