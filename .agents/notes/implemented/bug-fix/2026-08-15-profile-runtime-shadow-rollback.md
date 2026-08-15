# Agent Note: Reject profile-local runtime shadows and roll back plugin changes

Status: implemented

English | [中文](2026-08-15-profile-runtime-shadow-rollback.zh.md)

## Problem

Profile bundle manifests resolve from the dsh installation first, but the bare plugin rows inserted by those bundles resolve from the profile directory. A third-party plugin that declares `@deepseek-ai/dsh` or an in-box DSH/Cordis package as a normal dependency can therefore install another runtime under the profile's `node_modules`; Loader then imports those nearer backend and browser packages instead of the application's shipped copies. The result can replace the running UI and core services even though the profile still lists the installation-owned `dsh-base` and `dsh-web-app` bundles. The [profile plugin bundles decision](../architecture/2026-08-05-profile-plugin-bundles.md) owns bundle composition and the installation fallback; this note owns protection against a profile dependency shadowing that fallback.

## Decision

The installation dependency closure defines the protected package set, filtered to package names in the `@deepseek-ai/dsh*` and `@deepseek-ai/cordis*` families. `findProfileRuntimeShadows` checks each protected package at the profile's top-level `node_modules`, compares its real path with the installation copy, and reports different copies. `assertNoProfileRuntimeShadows` rejects a nonempty result, and every profile boot calls it before mounting the configuration tree.

`dsh plugin` records `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and the existing shadow set before forwarding an operation to pnpm. After pnpm succeeds, newly introduced protected copies make the command fail before bundle reconciliation. The command restores the recorded files, runs `pnpm install --ignore-scripts` to materialize the previous dependency graph, restores the recorded files again so a previously absent lockfile remains absent, and reports success only when pnpm succeeded and the new shadows are gone. Existing shadows are not treated as newly introduced, so `dsh plugin remove` remains available to repair a polluted profile; startup remains blocked until every shadow is removed.

External plugins declare DSH and Cordis packages as `peerDependencies` and resolve them through the installation fallback. The check does not prohibit intentional UI plugins or sandbox package code: enabled plugins and explicitly allowed lifecycle scripts still execute with the user's permissions.

## Verification

The profile unit test stages installation-owned DSH and Cordis packages beside an unrelated library, then proves that only differing runtime copies are reported and rejected. The built-bin tests install a local bundle with a transitive fake `@deepseek-ai/dsh-app-boot`, prove the command exits nonzero and restores the exact profile dependency state, and prove direct placement of the same shadow makes profile startup exit nonzero. The keyless CLI snapshot runs the source launcher through the same local bundle and pins the human-visible refusal, rollback confirmation, restored manifest, absent lockfile, and absent runtime copy.

## Alternatives considered

**Block known incompatible plugin names.** A blacklist fixes one package and misses renamed, aliased, git-hosted, or newly published packages with the same dependency mistake; package identity is not the violated invariant.

**Pin or override transitive DSH versions in pnpm.** An override can make an incompatible plugin appear installed while violating the version it declared, and it does not prevent the plugin from carrying a second Cordis instance through another dependency path.

**Resolve every bare row from the installation.** That prevents runtime shadowing but also makes out-of-tree plugin rows unresolvable from the profile. A split resolver would protect the root import but leave an incompatible dependency graph installed and available to third-party code, so install rejection remains necessary.

**Copy or rename the complete `node_modules` tree before each command.** Restoring a directory snapshot is stronger than rebuilding the old graph, but copying hundreds of megabytes makes every benign `why`, `add`, or `update` expensive and can fail on Windows while a running process watches plugin files.

## Consequences

Compatible plugin operations keep pnpm's ordinary behavior and bundle reconciliation. An incompatible operation may finish dependency resolution, downloads, and allowed lifecycle work before the post-install check rejects it; rollback prevents the resulting graph from becoming the next application runtime but cannot undo arbitrary side effects performed outside the profile dependency files. A profile modified outside `dsh plugin` fails at startup instead of silently loading another backend or browser UI, and its diagnostic names every shadow package that must be removed.
