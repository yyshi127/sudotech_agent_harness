# Agent Note: Declare Xiaojing's native-browser adoption precisely

Status: implemented

English | [中文](2026-10-03-xiaojing-native-browser-adoption.zh.md)

## Problem

Xiaojing selects the Harness native browser providers for Edge and Chrome. Those providers and their shared runtime remain experimental packages. The general [default-product isolation policy](2026-09-12-default-product-experimental-isolation.md) consequently rejects the product's actual implementation, even though the product has explicitly adopted it. Moving dependencies to a private app does not address that policy: every app is an installation root. Changing publication identity would misrepresent the upstream APIs' status.

## Decision

[`xiaojing-native-browser-adoption`](../../../../scripts/xiaojing-native-browser-adoption.ts) declares one product-specific adoption point. `packages/xiaojing/xiaojing-browser-control` must identify `@deepseek-ai/dsh-xiaojing-browser-control`. Its direct `dependencies` may include only these three adopted experimental identities: `browser-use-chrome-devtools-mcp`, `browser-use-playwright-mcp`, and `browser-use-runtime`, each under `packages/experimental/` with its exact `@deepseek-ai/dsh-experimental-` package name. The two providers may depend directly on that runtime. This adoption does not promote or rename any experimental API.

Runtime source imports are restricted to the consumer's `src/native.ts` importing those three package roots and each provider's `src/index.ts` importing the runtime's `/mcp` entry. References within the same package do not introduce another dependency. Configuration entrypoints, other importers, alternative source files, package subpaths, aliases, peers, and optional dependencies cannot claim adoption. The [shipped optional-bundle policy](2026-09-15-shipped-optional-bundles.md) is unchanged.

The workspace dependency check and default-product source traversal share this declaration. Traversal inspects all outgoing dependencies, runtime sources, and declared configuration trees of the adopted packages. No visited-package check may turn an unauthorized incoming edge into an accepted edge. The [installed-product check](../../../../scripts/release/installed-product-isolation.ts) compares each direct dependency reference with the resolved manifest's name and `repository.directory`, rejects alias and local-path ranges, and inspects the adopted packages' entire installed runtime graph. Other experimental identities remain forbidden.

Focused source, manifest, and installed-graph fixtures cover the accepted graph and reject identity spoofing, another consumer, another entrypoint, aliases, dependency-section changes, and transitive experimental expansion. The existing runtime and publication checks retain their independent responsibilities; declaring adoption does not establish that a browser connection succeeds.

## Alternatives considered

**Use the legacy Edge implementation.** That would contradict the product's decision to use native Harness browser control and omit the requested native Chrome route.

**Move provider construction to the private Desktop Host.** Private apps remain checked installation roots, and the Web product also needs this composition. A separate optional bundle would require moving the current native consumers and their deployment choices together; it does not represent the product's selected implementation.

**Allow every experimental browser package or every dependency of the consumer.** A prefix or owner-only exemption would silently accept new providers, runtime dependencies, and consumers. Exact source and resolved installation identities preserve the negative guarantees of the general isolation policy.

## Consequences

Xiaojing deliberately depends on these pre-stable native APIs and must update their consumers when upstream changes them. The default isolation rule stays strict outside the named adoption point. Source and installed-package checks must change together if this composition changes; unrelated products and optional bundles do not inherit its permission.
