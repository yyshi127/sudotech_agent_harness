---
description: "Xiaojing Finance client management and immutable session-context surfaces"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-xiaojing-finance-clients

English | [中文](README.zh.md)

## Summary

Removable Xiaojing Client presentation for local Finance client records and per-session context selection. The package is compiled only for `DSH_CLIENT_BUILD_PROFILE=xiaojing`; removing its Web composition row removes every Finance client UI without changing the Host service, other presets, or official Harness UI. The UI labels these records `Ledgers`; persistence, Remote identifiers, and Workspace paths use the Finance client model.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Ledger information

The blank-session ledger selector renders `short name-ledger name-ID value`; a historical record without a short name falls back to its legal name. The selected Youcheng ledger name is stored with its ID, so a restart does not replace a known name with a generic label; historical records without that stored name keep the generic fallback until the binding is selected and saved again. The full label remains available on hover when the chip is truncated. Selection still uses the local client ID, never the display text.

The plugin adds `Ledger information` above `Rename` in the row action menu for Finance customer Workspaces. Consultation and regular Workspaces do not receive this action; customer management is absent from Settings. The modal reads the selected customer's full record and submits the revision captured when editing began, so concurrent edits surface a conflict rather than silently replacing data.

The editor separates basic client details from finance-system configuration. The short name is required on create and update because compact menus cannot display long legal names reliably. A customer may remain unconfigured; selecting Youcheng reveals the test/production environment, AppKey, AppSecret, and ledger ID, while SDOO, Yonyou, and Kingdee remain selectable placeholders without connector fields. Account mappings are not manually maintained in this form. The page reads full details only over the loopback-only Remote and never receives a stored AppSecret: a blank secret preserves the credential already owned by the Host.

For Youcheng, the API environment and Host-resolved read-only API address share a row on wide screens and stack on narrow screens. Saving starts a separate connection check and shows progress; failure leaves the saved record intact. Customer Workspace titles show the verified account name and the 16 px leading mark from the Youcheng Finance logo after a successful check, or a red dot with a safe failure explanation. Gray means unverified, including after Host restart. The hover and accessible label include the ID and last-check time; the indicator does not grant business permissions. Consultation and ordinary Workspaces receive no badge.

The ledger-information dialog stays within the viewport. Its heading and action row remain visible while the fields scroll independently; narrow screens use a single column. Optional finance-policy notes are collapsed by default, remain editable on expansion, and are preserved when other fields are saved. They inform the client's AI context but do not configure API authentication or enforce permissions.

The editor obtains ledger choices through `Verify and get ledgers`, then requires a name-based single selection; the binding ID comes from the selected ledger and appears in its option label, without a separate ID input. Discovery uses draft credentials without saving them. Changing the finance system, environment, AppKey, or AppSecret clears the choices and selected ID, and late responses from earlier requests cannot restore them. Existing bindings remain saveable without re-entering credentials; requesting a fresh list requires selecting again. Cancelling leaves the saved binding intact.

Configured active Youcheng rows on loopback expose an always-visible link icon between the customer name and verified ledger name. A successful check makes the link horizontal and green, and replaces the success dot after the ledger name with the square Youcheng brand mark. It verifies the saved binding without opening the editor, rewriting the catalog, expanding the row, or changing the selected session. The link is disabled while checking; safe failures remain retryable. Host restart requires another explicit check, not another save. Archived and unconfigured rows expose no connection action.

Connection diagnostics distinguish timeout, network failure, and HTTP 403 access denial. A failed recheck removes the green success indicator even when a previously verified ledger name remains visible; retry uses the saved configuration.

## Attachment and reimbursement configuration

On loopback Xiaojing pages, Settings includes `Attachment storage`. It edits one computer-wide private OSS configuration, accepts write-only RAM credentials, and distinguishes saving from a real upload/download/cleanup test. Unsaved changes invalidate the displayed test result. New installations have non-secret deployment defaults but require their own authorized keys; neither product login nor bundled credentials are assumed. Storage scope and transfer limits belong to the [Finance Host](../../xiaojing/xiaojing-finance-domain/README.md#private-attachments-and-reimbursement-drafts).

The ledger information editor exposes financial connection settings only. It does not load, save, or test reimbursement configuration. Existing reimbursement credentials and historical records remain in Host storage; removing this UI entry does not delete them or disable the existing backend capability. Attachment storage settings remain available separately.

## Conversation context

Finance tool names registered by this product use a dedicated Chat card. Successful calls show the persisted business summary from `tool/result.meta`; running and older calls without that metadata display a localized status instead of raw arguments or model-facing JSON. Failed calls display a localized status and a short, screened plain-text reason when one is available; structured or technical errors remain hidden. The model still receives the complete tool result. This card applies only to the Xiaojing Finance tools and does not change the generic Harness renderer.

Committed `finance/file-published` events display an explicit file-opening button in Chat, including after history reload. The action uses the recorded destination with the existing Host opener; it does not depend on the model writing a link and does not open automatically. Non-loopback browsers cannot activate it. This is local-file opening, not download hosting or proof that the file still exists. Imports, archives and failed exports do not create a publication button.

The package fills the generic `conversation.hero.context` slot only for blank Finance sessions. A compact `Consultation / Ledger` selector beside the Finance preset defaults to `Consultation`. `Ledger` adds one ledger selector. The selection may change until the first turn; after binding, the session header shows the read-only client name. A consultation cannot be silently converted after work starts. An accounting month, quarter, or year is not session state; the relevant Finance Skill reads or requests it for each task.

The composer block is owner-scoped so Finance validation does not remove model, upload, Goal, Plan, or other independent blocks. Successful staging refreshes the displayed context even when a sidebar action reuses the current blank session; failed staging leaves the prior context intact. Connection reset discards browser assumptions about Host-memory staging and reloads the authoritative session state.

## Unified uploads

The plugin listens to the product-neutral local-file preparation event used by the existing upload button. It claims ready Finance sessions, lazily performs the ordinary local upload once, and asks the Host to register the file in that session. A client session copies the file into the selected client's original materials and returns replacement metadata for that copy. A general consultation keeps the file in the protected upload directory and records session-scoped authorization without creating a client copy. Supported client-session images remain in the native visual draft while the same bytes are also imported for durable client filing.

Known non-Finance sessions return no claim from the local session summary before any Finance Remote call or upload, so the uploader follows its existing path without extra latency or a second upload. A session missing from that summary is resolved by the Host before ownership is decided. If controlled registration or import fails, the document is not attached and a newly added image is removed from the draft; the browser reports the failure without leaving the composer cursor or attachment state inconsistent.

## Finance workspace category

The plugin registers a Finance Workspace provider through the generic `WorkspaceCategoryRegistry` and labels the two top-level categories `Office Companion` and `Finance Assistant`. The Finance category places customer Workspaces under `Ledgers` with the green ledger icon and consultation Workspaces under `Consultation` with the green discussion icon; archived customers keep history without a new-session action. Customer row menus order `Ledger information`, `Rename`, then `Remove workspace`; consultation rows keep only the generic rename and remove actions. Remove hides the Workspace from Finance while retaining its directory, registration, customer record, and session history; adding the same directory restores it, and the final listed consultation cannot be removed.

Selecting the Finance preset in a blank ordinary session opens a blank session in the Finance consultation Workspace. Selecting Standard, Plan, Goal, or another non-Finance preset while a blank Finance session is active returns to the remembered ordinary Workspace. The composer Workspace picker follows the preset: Finance shows only Finance Workspaces and all other presets show only regular Workspaces. Selecting a customer opens that customer's Workspace before staging its context. The generic sidebar owns rendering and search; this product plugin owns membership and navigation, so removing the plugin restores the ordinary Workspace UI without Finance conditions.

Workspace activation selects the Finance preset through `remote.agentPresets`; the Client surface injects that Remote before exposing Finance navigation.

Finance activation and return-to-ordinary navigation open their result only if no later navigation or plugin disposal has superseded them. An obsolete request may finish creating and preparing its blank Session but cannot replace the user's newer selection.

## Model Experience

Indirectly, through the Host-owned `financeClients.stage` selection that the Finance domain logs and renders before the first request.

#### KV Cache effect

None directly. The Host package owns the model-visible general or client-bound context and its cache effect.

## Known Limitations and Deferred Work

- Client creation captures the required basic fields; finance-system configuration is completed from the created customer's `Ledger information` action.
- SDOO, Yonyou, and Kingdee are selection placeholders; only Youcheng exposes connection fields.
- Archived records are read-only and remain visible for historical reference.
- The controls and dedicated workspace category appear only for the shipped Finance preset; user-authored and other system presets do not receive them.
- The ordinary Web page can use the feature only from loopback. Remote LAN browsers cannot read full client detail or change staged context.
- The Client starts controlled import but does not decide whether a later work file is a draft, formal output, or archive; the Finance Host context and `finance_files` tool own that decision.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
