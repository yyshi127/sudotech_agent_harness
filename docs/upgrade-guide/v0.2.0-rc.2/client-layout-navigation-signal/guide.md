---
kind: upgrade-guide
description: Custom client layout providers must expose the current navigation cancellation signal.
---

# Client layout navigation signal

English | [中文](guide.zh.md)

## Change

`ILayout` now requires the readonly `navigationSignal: AbortSignal` property. Custom layout providers and complete typed mocks must supply it. The standard `LayoutController` supplies it automatically. Startup consumers read this signal to preserve a later explicit navigation while Workspace category membership loads; reading it does not start or cancel navigation.

## Migration

1. Locate implementations of `ILayout` and complete mocks used as `ctx.layout`. See the [layout service definition](../../../../packages/client/ui-layout/src/client/service.ts).
2. Expose the signal of the same cancellation controller used by `beginNavigation()`. Preserve its identity until navigation changes. Reading the property must leave pending work intact; the next navigation, valid panel selection, and layout disposal must still cancel the previously returned signal.
3. Check that repeated reads preserve the current signal, that starting a navigation replaces it and aborts its predecessor, and that disposal aborts the current signal. Run the consuming Client program's type check to confirm that every complete implementation provides the property.
