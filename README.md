# Xiaojing Accounting

English | [中文](README.zh.md)

<p align="center"><img src="apps/desktop/assets/app-icon.png" alt="Xiaojing Accounting app icon" width="112"></p>

**Xiaojing Accounting — your AI office partner** is a Windows desktop agent for everyday office and finance workflows. It combines a desktop interface, a local workspace, and configurable AI model access in one installable application.

## What it provides

- **Install-and-run Windows application:** the installer includes its own Node.js runtime, so end users do not need to install Node.js separately.
- **Local workspace:** the application creates `小兢会计工作区` under the user's Documents folder and lets the agent work with files and commands within the permissions granted by the user.
- **Prompt file attachments:** users can upload local files into the current prompt, remove pending files before sending, and manage stored uploads in Settings.
- **Editable model settings:** users configure a DeepSeek API key after launch and can replace it later from the same settings page.
- **Sudotech product experience:** the interface, product name, visual system, first-use guide, installer, and deployment defaults are customized for Xiaojing Accounting.

![Xiaojing Accounting desktop interface](apps/xiaojing-download/assets/app-preview.png)

<a id="run"></a>

## Install and start

The distributed installer supports 64-bit Windows 10 and Windows 11.

1. Download the Windows installer from the company distribution page.
2. Run the installer and choose a parent folder. The installer appends the fixed `xiaojing-agent-desktop` application directory.
3. Start Xiaojing Accounting from the desktop or Start menu. The bundled runtime starts automatically.

## Configure the API key

1. Sign in to the [DeepSeek Platform](https://platform.deepseek.com/) and create an API key.
2. In Xiaojing Accounting, open **Settings → Models**, find DeepSeek, and select **Edit**.
3. Paste the key into **API key**, then save the settings. Return to the same page whenever the key needs to be replaced.
4. Treat the API key as sensitive information. Do not share it in chats, screenshots, or files.

<a id="run-from-source"></a>

## Develop from source

Source development requires Node.js `^22.19.0` or `>=24.0.0` and pnpm `11.7.0`.

```sh
git clone git@github.com:yyshi127/sudotech_agent_harness.git
cd sudotech_agent_harness
corepack enable
pnpm install
pnpm desktop:dev
```

Build the Windows installer with:

```sh
pnpm desktop:dist
```

The generated installer is written under `apps/desktop/dist/installer/`. Build output and bundled runtime binaries are intentionally excluded from Git.

## Repository layout

- `apps/desktop/` contains the Electron shell, loading page, installer configuration, and desktop assets.
- `apps/web/` contains the Web interface assembled into the desktop application.
- `apps/xiaojing-download/` contains the static Windows download page.
- `packages/` contains the DeepSeek Harness packages and the product-facing UI customizations.

## Upstream and attribution

This repository is built directly on the open-source [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), which is developed by [DeepSeek AI](https://deepseek.com). Ruihua Cloud Sudotech customizes the interface, branding, default configuration, and Windows packaging for its internal and authorized product use.

Xiaojing Accounting is not an independent reimplementation of the underlying agent harness and is not an official DeepSeek desktop release. DeepSeek Harness attribution and third-party notices remain part of the source tree and installer.

## Project status

Xiaojing Accounting is currently an internal beta intended for authorized users. Interfaces, configuration, and installer behavior may change between releases.

## License

The DeepSeek Harness source remains available under the [MIT License](LICENSE). Third-party dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
