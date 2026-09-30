---
description: "Shared deterministic local document normalization for Xiaojing sessions"
kind: "package-reference"
---

# @deepseek-ai/dsh-xiaojing-finance-documents

XML syntax is validated with `fast-xml-validator` before parsing with `fast-xml-parser`; entity expansion remains bounded by the parser settings.

English | [中文](README.zh.md)

## Summary

This Xiaojing Host capability provides one deterministic local parser for uploaded PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and text files. Two session adapters authorize sources without duplicating parsing logic: Finance sessions consume immutable Finance import events through `finance_document`, while Standard, Goal, Plan, and other non-Finance Xiaojing sessions consume durable human-upload references through `document_reader`. The package does not modify the Agent Loop or add another upload control.


## Table of Contents

- [Capabilities](#capabilities)
- [Dev Note](#dev-note)

<a id="capabilities"></a>
## Source authorization and normalization

The existing Xiaojing upload button remains the only file entry. Finance customer uploads are committed by `xiaojing-finance-domain` to the bound customer's `02-原始资料` directory and recorded as `finance/file-imported`; Finance consultation uploads are recorded as `finance/consultation-file-imported`. The Finance adapter accepts only those immutable current-session records and preserves customer or consultation isolation.

For non-Finance sessions, the ordinary adapter scans only durable `user/message` events created by a human in the current session. It accepts the exact upload-reference lines emitted by the bundled upload plugin, requires the canonical source to remain below Xiaojing's protected upload directory, and rejects plugin-authored text, arbitrary paths, symlinks, directories, and uploads from another session. Both adapters verify a regular file and its recorded size before parsing. An authorized file above the configured size limit returns `file-too-large` before SHA-256 scanning or Worker admission; accepted files still require SHA-256 verification before cache access.

Supported formats produce bounded, source-located units:

- PDFs produce text page units when available, render every text-poor page as a bounded PNG, and retain decodable raster XObjects from text-rich pages with page locations;
- DOCX files produce paragraph units and retain raster pictures referenced by the main document;
- XLSX files produce sheet-row units without executing formulas and retain worksheet-drawing pictures with nearby cell locations;
- PPTX files produce ordered slide units containing extractable shape and table text plus speaker notes;
- recognized digital-invoice XML or XBRL produces labeled invoice fields;
- OFD files produce page units, retain page-referenced raster pictures, and expose embedded digital-invoice XML or XBRL fields when present;
- CSV files produce row units;
- TXT files produce line-range units.

PNG, JPEG, WebP, and GIF uploaded as images remain on the native DeepSeek visual route. The tool's `visuals` action sends a bounded batch of rendered PDF pages or retained PDF, DOCX, XLSX, PPTX, and OFD pictures to the current image-capable model and preserves each source location. A scanned or mixed PDF therefore uses deterministic text for pages that have a useful text layer and complete-page visual input only for pages whose text layer is missing or sparse. Charts, SmartArt, vector drawings, animations, video, and embedded objects are not otherwise rasterized or reconstructed. This package does not perform OCR; the active image-capable model interprets rendered scan pages. Legacy Office formats such as `.doc`, `.xls`, and `.ppt` return an explicit unsupported status.

Digital invoices are accepted in the PDF, OFD, and XML delivery formats documented by Chinese tax authorities. PDF uses the ordinary text-and-picture path. XML accepts only records with a recognized invoice number, party, and amount combination. OFD reads page text and images and also scans its package for an embedded recognized XML or XBRL invoice payload. These operations parse content only; they do not validate an electronic signature, establish authenticity, query invoice status, or replace the official invoice verification service.

The parser runs in a serialized Worker with a wall deadline and V8 memory ceiling. The default single-document limit is 100 MiB, matching the bundled upload plugin. File size, PDF-page, presentation-slide, text, sheet, row, column, cell, unit, model-read, visual-count, and visual-byte limits remain deployment configuration. The complete generated reference lives in the [configuration catalog](../../../docs/config-catalog.md).

## Tools and mode isolation

`document_reader` is registered globally only in the Xiaojing build, so every non-Finance Xiaojing preset receives the same local document capability. It supports `list`, `read`, and `visuals`; it cannot accept a filesystem path. The Finance preset registers `finance_document` with the same actions and explicitly hides `document_reader` in that scoped Agent. This keeps one parser implementation while preventing the ordinary adapter from bypassing Finance customer authorization.

Normalized content enters the model only as an ordinary logged tool result. It is not inserted into the standing system prompt. Pagination limits text and visual batches, and the exact active model route must declare image input before `visuals` succeeds.

## Persistence and removal

Normalized records use durable schema version `3` and parser version `4` below `$DSH_HOME/finance/documents/v3/normalizer-v4/<scope-hash>/`. The additional parser directory prevents records created before complete-page rendering from suppressing scan visuals. Existing normalizer versions and `v1` or `v2` cache files remain untouched. Atomic writes, file locks, and a key derived from the verified content hash and format protect each record. Finance client identity scopes customer records, Finance consultation identity scopes consultation records, and ordinary sessions use their session identity. The cache contains no API keys, prompts, model output, or source files. Corrupt cache data rejects initialization and remains unchanged.

Remove the `xiaojing-finance-documents` Host row and `xiaojing-document-reader` consumer row to remove ordinary document reading. Remove the Finance preset's `finance-documents` consumer row to remove the Finance tool. Upload, original files, customer records, official evidence, and official Harness profiles remain independent.

## Model Experience

### Shared deterministic document reader

#### What the model sees

Non-Finance Xiaojing presets receive `document_reader(action, document_id?, cursor?)`; Finance receives `finance_document(action, document_id?, cursor?)`. `list` returns only the current session's authorized documents and parser states, `read` returns bounded source-located text units, and `visuals` returns a bounded document-picture batch with source locations. Both tools direct the model away from trial-and-error Shell, Python, Office, filesystem-path, or converter attempts.

#### Token effect

Only explicitly read text units or visual batches enter the calling session. No normalized corpus is injected into unrelated turns or sessions.

#### KV Cache effect

Tool output varies by selected document and cursor and appears after the stable prompt prefix.

## Known Limitations and Deferred Work

- The package extracts source text, saved cell values, retained raster pictures, and recognized digital-invoice fields; it does not infer accounting entries, validate tax treatment, or perform semantic review.
- Digital-invoice parsing does not verify signatures, authenticity, invoice status, deductions, or booking state.
- It renders complete text-poor PDF pages only. It does not render complete OFD or Office pages and does not bundle OCR, ONNX, Python, Microsoft Office, or an external OCR service.
- DOCX picture coverage is limited to raster images referenced by the main document; headers, footers, complex layout, embedded objects, tracked-change intent, macros, charts, and protected content are not reconstructed.
- XLSX formulas are not executed; only worksheet drawing rasters are retained, while visual layout, hidden state, macros, charts, and embedded objects require separate handling.
- PPTX visual review covers only slide-referenced PNG, JPEG, WebP, and GIF files. Charts, SmartArt, vector drawings, media, transitions, and embedded objects require the original presentation or a future renderer.
- Password-protected, corrupt, over-limit, or unsupported files fail explicitly instead of entering an ad-hoc fallback loop.

<a id="dev-note"></a>
### Dev Note

None.

No invariant companion is published because registries and the owning services enforce these relationships directly; this package has no independent observation to compare.
