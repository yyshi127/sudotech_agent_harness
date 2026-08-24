# Agent Note: Profile module fallback without reparse points

Status: implemented

English | [中文](2026-08-24-profile-module-fallback-without-reparse-points.zh.md)

## Problem

The profile launcher previously populated `$DSH_HOME/profiles/node_modules` with one symbolic link or Windows junction for every package in the installed app's dependency closure. Windows endpoint policy can deny reparse-point creation with `EPERM`, which prevented both desktop and portable distributions from starting. A copied package directory left by an earlier attempt then caused every later launch to fail because the path existed but was not a managed link.

The fallback must continue to let profile-installed plugins import the app-owned Harness and Cordis packages without allowing stale copies to replace the current installation. It must not require administrator rights or Developer Mode, and migration must not delete user data.

## Decision

`registerProfileModuleFallback()` installs a synchronous Node resolution hook for imports whose parent module is under the selected Harness-home `profiles` directory. Resolution first follows Node's ordinary profile-local rules. Only an `ERR_MODULE_NOT_FOUND` for a bare package specifier retries against the matching package in the installed app's complete `dependencies` and `peerDependencies` closure. Package export and subpath errors remain errors; packages outside that closure do not become visible.

The launcher registers the hook before mounting the profile tree and owns its idempotent disposer as a root Cordis effect. Built-in packages therefore come from the running installation, while a normally installed third-party package under `profiles/<name>/node_modules` retains first priority. Startup no longer creates a symbolic link, junction, or package copy.

The Web client-module registry resolves package manifests through the Loader's Node ESM resolver when it is available. Plugin imports and `dsh.client` metadata therefore use the same profile-first and current-install fallback. Without this shared resolver, a clean profile could activate every Host plugin but still emit an empty browser boot graph because the registry's independent `require.resolve` could not see the installation fallback.

If ordinary resolution finds an app-owned package under the obsolete shared `$DSH_HOME/profiles/node_modules` path, the hook rejects that result and resolves the package from the current installation instead. The shared directory and per-profile `node_modules` directories remain byte-unchanged, as do sessions, credentials, settings, presets, attachments, plugin state, and workspaces.

## Alternatives considered

- **Require Developer Mode or administrator rights.** Rejected because ordinary installed and USB-portable use must work under endpoint policies the product does not control.
- **Copy the installation dependency closure into the Harness home.** Rejected because copies drift across upgrades, duplicate the runtime, and recreate the shadowing failure this change removes.
- **Keep using Windows junctions instead of symbolic links.** Rejected because the failing implementation already requested junctions and the target endpoint denied reparse-point creation.
- **Resolve every missing import globally from the app.** Rejected because it would hide undeclared dependencies outside profile execution and could change unrelated module resolution.

## Consequences

Desktop and portable startup no longer depend on Windows reparse-point permission. Existing standard profiles and plugins keep their resolution order, and future in-place upgrades select app-owned packages from the newly installed app rather than an old shared fallback. A manually placed package outside the app dependency closure can still resolve from the obsolete shared path, but supported plugin installation remains profile-specific. Built-bin coverage verifies the shipped Web and headless profiles, an out-of-tree profile plugin, an indirect app dependency, and a poisoned ordinary fallback directory that remains in place. Client-module coverage exercises the Node 22 and Node 24 resolver interfaces, and a relocated portable smoke verifies that the complete Xiaojing browser graph is present without reparse points. Unit coverage verifies non-mutation and idempotent hook disposal.
