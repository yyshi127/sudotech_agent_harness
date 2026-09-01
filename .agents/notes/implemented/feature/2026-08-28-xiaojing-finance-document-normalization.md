# Agent Note: Xiaojing Finance deterministic document normalization

Status: implemented

English | [中文](2026-08-28-xiaojing-finance-document-normalization.zh.md)

## Problem

Finance users import PDF, Word, Excel, PowerPoint, CSV, and text files through one existing upload control. DeepSeek native vision handles images, but non-image documents previously left the Agent to discover and retry shell utilities, Python packages, Office automation, or converters. That behavior was slow, environment-dependent, difficult to reproduce, and unsafe for customer-isolated data. Scanned PDFs and image-only presentations also looked like empty text documents unless the Agent happened to identify the missing text layer.

The solution must remain removable, avoid Agent Loop changes, preserve the existing upload and customer-file lifecycle, use no external service or additional API key, add no bundled OCR or Python runtime, and make every model-visible result reconstructable from the session log.

## Decision

`@deepseek-ai/dsh-xiaojing-finance-documents` is a Xiaojing-only Host capability. It accepts only immutable current-session authorization events. A client-bound upload is copied into `02-原始资料` and logged as `finance/file-imported`; a general-consultation upload remains below the protected local upload root and is logged as `finance/consultation-file-imported`. Before parsing or returning a cache hit, the service resolves the canonical path, requires a regular non-symlink file below the event's authorized root, and verifies the recorded size and SHA-256.

The Host supports PDF, DOCX, XLSX, PPTX, digital-invoice XML, OFD, CSV, and TXT. It emits bounded page, paragraph, sheet-row, slide, field, CSV-row, or line-range units and records supported raster visuals with source locations. For PDF, it extracts the text layer first and renders only pages whose text is missing or below the configured threshold. Each selected page becomes a bounded PNG through PDF.js and `@napi-rs/canvas`; the existing `visuals` action sends that page to the current image-capable model. Text-rich PDF pages retain direct text and decodable XObject images, so mixed PDFs do not pay the visual cost for every page. Unsupported, encrypted, malformed, over-limit, or timed-out files return explicit safe status instead of entering a converter fallback.

Parsing runs in one serialized Worker with a wall deadline and V8 memory ceiling. The Worker receives a scrubbed environment, validates source metadata again, and returns a schema-validated terminal message. Deployment configuration owns file, PDF-page, presentation-slide, text, unit, sheet, row, column, cell, timeout, memory, and model-read limits. Formula execution, OCR, visual presentation reconstruction, semantic invoice extraction, accounting classification, and tax review are outside this deterministic phase.

Normalized records retain durable schema version `3` and use normalizer version `4` below `$DSH_HOME/finance/documents/v3/normalizer-v4/<scope-hash>/<content-hash>.<kind>.n4.json`. The normalizer-specific directory keeps all earlier derived records unchanged and prevents a pre-render cache hit from suppressing scanned-page visuals. Client identity scopes a client session; session identity scopes a general consultation. The scope value is hashed before entering the path. File locking and atomic replacement protect writes, corruption stops initialization without replacing the damaged record, and cache hits still require a valid current source file. Scope hashing prevents one customer or consultation session from reusing another scope's cache record.

The Finance preset alone loads `@deepseek-ai/dsh-xiaojing-finance-documents/tool`. `finance_document` first lists current-session imports, then reads bounded units by opaque document id and cursor. Its result is an ordinary structured `tool/result`; normalized content is not injected into the standing prompt and does not require a duplicate session event because the import event already reconstructs source authorization. The bundled Finance Skill directs supported files to this tool and forbids shell, Python, Office, and ad-hoc converter attempts.

`src/compat.ts` is the only adapter for current Harness Finance binding and import events. The Host row, preset consumer, skill, package inventory, and resolver dependencies belong to the Xiaojing product layer. Removing those entries leaves upload, original customer files, official evidence, Standard mode, and official Harness profiles unchanged.

## Alternatives considered

- **Let the Agent continue discovering local tools.** Rejected because behavior depends on each machine, repeatedly consumes model turns, and cannot guarantee customer isolation or stable locators.
- **Convert every document or every PDF page to images.** Rejected because long documents become expensive, slower, and less precise for searchable text and tabular values. Rendering only text-poor PDF pages preserves deterministic text while covering scanned and mixed PDFs.
- **Bundle OCR, ONNX, or Python.** Rejected for this phase because it materially increases package size and maintenance while text-layer documents already have deterministic local parsers.
- **Use Microsoft Office automation.** Rejected because Office is not guaranteed to be installed, desktop automation is foreground-sensitive, and macros or prompts introduce unsafe side effects.
- **Store normalized files inside the customer Workspace.** Rejected because parser cache is product implementation data, not a user-authored source or deliverable. Original materials remain visible in the customer Workspace; the cache belongs below protected Harness data.
- **Treat a local path mentioned in conversation text as upload authorization.** Rejected because prompt text cannot prove that the current session uploaded the file and would permit cross-session or arbitrary local-file reads. Only the upload bridge and durable session event authorize parsing.
- **Inject complete normalized content into every prompt.** Rejected because it wastes tokens, destabilizes the prompt prefix, and exposes documents to unrelated turns. The model reads only requested units.

## Verification

Parser tests use real minimal PDF, DOCX, XLSX, and PPTX containers plus CSV and TXT inputs. They pin PDF page rendering, mixed text-and-image selection, exact visual re-extraction, page, paragraph, slide order, speaker notes, XML entity decoding, line, sheet-row, native-vision, unsupported-format, slide-limit, non-text-content warning, and truncation behavior. Store tests pin client isolation, opaque path components, normalizer-version isolation, atomic persistence, and corrupt-record preservation. Normalizer tests exercise a real scanned PDF through the isolated Worker and prove that the recorded page can be re-rendered with the same key, in addition to hash-cache reuse, changed-source rejection, and original-material path confinement. Tool tests pin readable statuses, source locators, warnings, and cursors.

The shipped Web composition tests mount the real Finance preset, prove that Standard receives no document tool or Skill, execute `finance_document` against both a client CSV and a general-consultation CSV without a model or API key, and snapshot their logged source-located results. The product-layer verifier requires the Host row, Finance consumer, Skill, resolver dependency, package inventory entry, Xiaojing-only profile gate, and compatibility adapter.

## Consequences

Finance document reading is predictable, local, session-authorized, scope-isolated, logged, and fast for supported documents. Users keep one upload entry in both consultation and client sessions, and the model no longer spends turns discovering converters. Scanned and mixed PDFs now use the existing visual model without an OCR runtime or external parser. Legacy Office formats such as `.ppt`, complete Office or OFD page rendering, visual presentation reconstruction, formula recalculation, macros, semantic finance extraction, and OCR remain separate capabilities. A configured model without image input can still read text units but cannot interpret rendered scan pages.
