# Agent Note: Xiaojing incremental release history

Status: implemented

English | [中文](2026-08-30-xiaojing-incremental-release-history.zh.md)

## Problem

The Xiaojing About page showed one cumulative feature list under the installed version. After a release added Finance capabilities, that presentation attributed features already shipped in 0.2.2 to 0.2.3 and removed the user's ability to inspect an earlier release's additions.

## Decision

The product package owns a newest-first `XIAOJING_RELEASE_HISTORY`. Each record contains one explicit version and only the features added by that release. A new release prepends one record; existing records remain unchanged. The About page renders the first record as the current release and every remaining record as version history.

The 0.2.3 record contains the Finance Stage 1 increments F1-0 through F1-6. The 0.2.2 record retains native vision and unified uploads, Weixin, Edge control, local usage accounting, Visualize, and Desktop Xiaojing. Product tests require the first record to equal the Web version fallback and reject duplicate release versions; the Web settings snapshot records both sections.

## Alternatives considered

**Keep one cumulative current-version list.** Rejected because it cannot answer what changed from the immediately preceding release and rewrites product history whenever a capability inventory changes.

**Generate history from the active plugin inventory.** Rejected because the current composition describes what is installed, not when each capability first shipped. Removing or replacing a plugin would also rewrite historical release claims.

## Consequences

Users can inspect incremental changes for the installed release and retained earlier releases in one page. Each release requires a curated data record and localized copy, but that explicit maintenance prevents old features from silently moving into a newer version. The history is a product release record, not a complete inventory of every active plugin.
