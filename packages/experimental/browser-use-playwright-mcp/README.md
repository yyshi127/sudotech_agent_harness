---
description: "Operate Chromium through Playwright MCP with separate browser state for each live Session."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-browser-use-playwright-mcp

English | [中文](README.zh.md)

## Summary

Use Playwright MCP to inspect pages and operate Chromium, Chrome, or Microsoft Edge through its upstream tools. The provider initializes a Session's MCP connection before creation or resume completes and retains it across turns. Launch a separate browser or connect one Session to an existing browser through a debugging endpoint or the Playwright extension. This published experimental package activates only when explicitly mounted.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount both entries before creating or resuming a Session, in a profile composition that supplies Agents, tools, system prompts, and the working-directory service. Loading or reloading this provider does not adopt Sessions that are already active. Browser installation follows the upstream runtime; select an existing Chromium installation with `executablePath`.

```yaml
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
  config:
    mode: launch
    headless: true
```

Use `mode: attach` and set `endpoint` to an HTTP(S) debugging URL or WS(S) browser endpoint to operate an existing browser. The new live Session claims the attachment during initialization and retains it until unloading. If the attachment is busy, that activation continues without this browser and does not retry on later turns. After release, a newly created or resumed activation can acquire it. Direct calls from another Session fail. Cleanup disconnects and leaves the external browser and its pages running.

Use `mode: extension` with the [Playwright extension](https://github.com/microsoft/playwright/tree/main/packages/extension#readme) installed in the selected browser to operate existing tabs without configuring a debugging endpoint. Set `browser: chrome` or `browser: msedge` to open the connection page in that browser; the user authorizes the connection and selects the tab through the extension. `executablePath` can select a nonstandard installation. An optional `extensionToken` pairs with that browser's extension and is passed only through the child environment. Extension connections have the same Session exclusivity and disconnect-only cleanup as endpoint attachments.

For multiple provider instances, use a separate `browserUse` isolation realm and a unique `serverName` for each instance. The namespace distinguishes tools; it does not select a browser or grant access to another Session.

| Field | Default | Meaning |
|---|---|---|
| `mode` | required | `launch`, `attach`, or `extension`, fixed for this provider activation |
| `browser` | `chromium` | Launch or extension browser channel: `chromium`, `chrome`, or `msedge` |
| `serverName` | `playwright-mcp` | MCP tool namespace, 1–32 ASCII letters, digits, underscores, or hyphens |
| `headless` | `true` | Launch without a visible window; launch mode only |
| `executablePath` | upstream discovery | Browser executable for launch or the extension connection page |
| `endpoint` | required for attach | Existing browser debugging endpoint |
| `extensionToken` | absent | Secret pairing token for extension mode; never passed in command arguments |
| `dnsResultOrder` | `ipv4first` | Node lookup order for the extension relay: `verbatim`, `ipv4first`, or `ipv6first`; extension mode only |
| `toolCallTimeoutMs` | MCP client default | Per-call timeout in milliseconds |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-experimental-browser-use-playwright-mcp) lists accepted fields. The profile or preset selects the browser mode. The child process clears inherited `PLAYWRIGHT_MCP_*` options and then applies the explicitly configured extension token so ambient options cannot replace that configuration.

Extension mode passes Node's `--dns-result-order` before the native CLI. IPv4 first avoids an inaccessible IPv6 loopback relay on hosts that block local IPv6 connections; `verbatim` preserves the resolver's order. This setting changes only the extension server's hostname lookup and does not modify browser profiles, operating-system networking, launch mode, or endpoint attachments.

When configuring the system prompt's `toolOrder` for the whole process, leave browser tools under `<unlisted-tools>`. Explicitly listing browser tool names can make prompt assembly fail for Sessions without a browser connection.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider resolves its pinned npm entry and starts it under the current Node executable. A temporary protocol probe may precede the serving process. The [shared runtime](../browser-use-runtime/README.md) owns awaited Agent initialization, per-Session serialization, and cleanup; the [MCP client](../../mcp/mcp-client/README.md) owns transport, discovery, and result projection.

`createSessionMcpOptions(config)` resolves the same executable, arguments, environment, namespace, and exclusivity without starting a process or registering a provider. Consumers can use these options with the shared Session runtime to initialize a connection only when a task needs it.

Browser state survives turns while its live Session remains attached. The MCP server starts in the Session's validated current working directory and retains that launch directory after later Session directory changes. Disposal waits for server shutdown before releasing resources. Resume after reload starts fresh browser runtime state; stored conversation history does not restore cookies or pages.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Browser use](../../../docs/subsystems/browser-use.md) — provider selection and Session ownership.
- [Browser-use service](../../browser-use/browser-use/README.md) — exclusive provider registration.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) — upstream installation and browser behavior.

-----

<a id="model-experience"></a>
## Model Experience

### Browser tools and screenshots

#### What the model sees

Tools retain upstream descriptions and JSON schemas under `mcp__<serverName>__<tool>` names; the default prefix is `mcp__playwright-mcp__`. Text and screenshots use the normal tool-result pipeline and Session log. Screenshots require an attachment store and an image-capable model route; other routes receive the MCP image diagnostic. The MCP client also exposes resource helpers and attributed server instructions. Browser instructions are shown only after this Session owns a connection; targeted resource requests enforce the same ownership.

#### Token effect

The catalog, resource helpers, and server instructions add tool definitions and prompt text. Calls add arguments, text, and admitted images to Session history. Inline image bytes stay outside model-visible history.

#### KV Cache effect

An unchanged catalog preserves its tool-definition prefix. Results append to history; provider or catalog changes can reduce prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The integration retains the pinned server's browser and tool restrictions.

- Chromium-family browsers only; Firefox and WebKit are not selectable.
- Extension mode requires the extension in the selected browser and user authorization of the tab. Installing a browser alone does not enable access to its existing tabs.
- Startup failure or cancellation rejects Session creation or resume and triggers client cleanup. A disconnected client is not retried; after fixing the cause, create a new Session or unload and resume the existing one.
- Attachment exclusivity is local to this provider instance. Other processes and browser users can still modify the same pages.
- The shared resource-server inventory can show inherited server names; it does not grant access to another Session's browser.
- Cancellation does not undo navigation, clicks, or other actions already delivered to the browser.
- Tool schemas follow the pinned experimental dependency and carry no DSH stability promise.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
