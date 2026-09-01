# @deepseek-ai/dsh-client-ui-xiaojing-finance-clients

English | [中文](README.zh.md)

Removable Xiaojing Client presentation for local Finance client records and per-session context selection. The package is compiled only for `DSH_CLIENT_BUILD_PROFILE=xiaojing`; removing its Web composition row removes every Finance client UI without changing the Host service, other presets, or official Harness UI.

## Settings

The plugin registers `settings.section` id `finance-clients` at order `22`, after Agent Presets and before Channels. The page lists active and archived taxpayer entities, creates and edits full records, and archives active records after explicit confirmation. Every mutation uses the catalog revision returned by the Host, so concurrent edits surface a conflict rather than silently replacing data.

The page reads full details only over the loopback-only Remote. It does not persist a second browser copy of client records, credentials, or external-system secrets.

## Conversation context

The package fills the generic `conversation.hero.context` slot only for blank Finance sessions. A compact `Consultation / Client` selector beside the Finance preset defaults to `Consultation`. `Client` adds one client selector whose footer creates a client. The selection may change until the first turn; after binding, the session header shows the read-only client name. A consultation cannot be silently converted after work starts. An accounting month, quarter, or year is not session state; the relevant Finance Skill reads or requests it for each task.

The composer block is owner-scoped so Finance validation does not remove model, upload, Goal, Plan, or other independent blocks. Connection reset discards browser assumptions about Host-memory staging and reloads the authoritative session state.

## Unified uploads

The plugin listens to the product-neutral local-file preparation event used by the existing upload button. It claims ready Finance sessions, lazily performs the ordinary local upload once, and asks the Host to register the file in that session. A client session copies the file into the selected client's original materials and returns replacement metadata for that copy. A general consultation keeps the file in the protected upload directory and records session-scoped authorization without creating a client copy. Supported client-session images remain in the native visual draft while the same bytes are also imported for durable client filing.

Known non-Finance sessions return no claim from the local session summary before any Finance Remote call or upload, so the uploader follows its existing path without extra latency or a second upload. A session missing from that summary is resolved by the Host before ownership is decided. If controlled registration or import fails, the document is not attached and a newly added image is removed from the draft; the browser reports the failure without leaving the composer cursor or attachment state inconsistent.

## Finance workspace category

The plugin registers a `Finance workspaces` provider through the generic `WorkspaceCategoryRegistry` and labels the ordinary category `Regular workspaces`. The Finance category places consultation Workspaces under `Consultation` and customer Workspaces under `Clients`; archived customers keep history without a new-session action. Both sections expose the same row-menu rename and remove actions. Remove hides the Workspace from Finance while retaining its directory, registration, customer record, and session history; adding the same directory restores it, and the final listed consultation cannot be removed.

Selecting the Finance preset in a blank ordinary session opens a blank session in the Finance consultation Workspace. Selecting Standard, Plan, Goal, or another non-Finance preset while a blank Finance session is active returns to the remembered ordinary Workspace. The composer Workspace picker follows the preset: Finance shows only Finance Workspaces and all other presets show only regular Workspaces. Selecting a customer opens that customer's Workspace before staging its context. The generic sidebar owns rendering and search; this product plugin owns membership and navigation, so removing the plugin restores the ordinary Workspace UI without Finance conditions.

## Model Experience

Indirectly, through the Host-owned `financeClients.stage` selection that the Finance domain logs and renders before the first request.

#### KV Cache effect

None directly. The Host package owns the model-visible general or client-bound context and its cache effect.

## Known Limitations and Deferred Work

- The settings page supports manual maintenance only.
- Archived records are read-only and remain visible for historical reference.
- The controls and dedicated workspace category appear only for the shipped Finance preset; user-authored and other system presets do not receive them.
- The ordinary Web page can use the feature only from loopback. Remote LAN browsers cannot read full client detail or change staged context.
- The Client starts controlled import but does not decide whether a later work file is a draft, formal output, or archive; the Finance Host context and `finance_files` tool own that decision.
