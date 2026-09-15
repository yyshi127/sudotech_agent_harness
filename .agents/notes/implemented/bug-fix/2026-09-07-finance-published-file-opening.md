# Agent Note: Open committed Finance deliverables

Status: implemented

English | [中文](2026-09-07-finance-published-file-opening.zh.md)

## Problem

Finance export destinations are assigned after publication, so call-time file locations cannot identify them. Successful exports can remain plain text even when the model names the correct path.

## Decision

The Finance client plugin projects each existing `finance/file-published` event into a keyed Chat node. Its button uses the committed name and exact path with the existing Host file opener. Only a user click opens a file; non-loopback clients show a disabled action. Import, archive, failed export and assistant prose do not create this node. The [package README](../../../../packages/client/ui-xiaojing-finance-clients/README.md) owns the user-visible behavior.

## Alternatives considered

Model-written links cannot guarantee delivery. Expanding generic tool-result presentation would affect unrelated tools; the durable Finance event already supplies the required evidence without a protocol change.

## Consequences

History replay reconstructs file actions without repeating the export or changing model context. The action opens a local file, not a browser download; missing files and unavailable spreadsheet applications remain Host opener failures. Component checks cover exact-path clicks and remote disabling; assembled export checks cover the actual publication and page reload. Business-query accuracy and workbook content require separate verification.
