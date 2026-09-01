# Agent Note: Xiaojing shared document reading

Status: implemented

English | [中文](2026-08-29-xiaojing-shared-document-reading.zh.md)

## Problem

The Finance preset needs deterministic local parsing for uploaded business documents, but ordinary Xiaojing presets cannot depend on model-driven discovery of shell utilities, Python packages, Office automation, or converters. Text-only extraction also loses raster evidence embedded in PDF, DOCX, XLSX, PPTX, and OFD documents. Digital invoices add XML, XBRL, and OFD package data that must be parsed without treating arbitrary XML as an invoice or implying that content extraction verifies authenticity. Copying parsers or trusting a model-supplied filesystem path would create divergent implementations and permit cross-session local-file reads.

The extension must give every non-Finance Xiaojing preset the same parser behavior, preserve Finance customer isolation, reuse the existing upload control and native vision transport, remain removable, and avoid Agent Loop changes.

## Decision

`@deepseek-ai/dsh-xiaojing-finance-documents` owns one parser, normalizer, cache, and model-output implementation. A generic `DocumentSource` abstraction accepts only already-authorized source records. The Finance adapter reconstructs those records from immutable `finance/file-imported` and `finance/consultation-file-imported` events. The ordinary adapter scans only durable human `user/message` events in the current session, recognizes the exact upload-reference lines emitted by the bundled upload plugin, confines canonical paths to the configured Xiaojing upload root, and rejects plugin-authored text, arbitrary paths, directories, symlinks, and other sessions.

The Xiaojing Web composition registers a global `document_reader` consumer for Standard, Goal, Plan, and other non-Finance presets. Finance continues to register `finance_document` and uses the scoped tool registry to deny `document_reader`, so the generic route cannot bypass customer authorization. Both tools expose the same `list`, `read`, and `visuals` actions; neither accepts a path. Official Harness profiles do not load either Xiaojing consumer.

The upload hook declines a session that the local session list identifies as non-Finance before any Finance RPC or upload. Unknown sessions still use the Host as the authority. The normalizer validates the authorized path and recorded size first, rejects an over-limit source before hashing or Worker admission, and verifies the digest before cache access for accepted files. Its default single-document limit is 100 MiB, equal to the bundled upload manager's default, so an accepted upload is not rejected by a lower parser default.

Normalization records complete renders of text-poor PDF pages plus source-referenced raster pictures from text-rich PDF pages, the DOCX main document, XLSX worksheet drawings, PPTX slides, and OFD pages. PDF rendering uses PDF.js with `@napi-rs/canvas`, applies configured width, pixel, count, and aggregate-byte limits, and does not invoke OCR. The `visuals` action revalidates the source file, extracts exact format-owned keys in the isolated Worker, writes each image through the canonical attachment store, and returns native image blocks labeled with page, paragraph, cell, slide, or OFD page locations. It fails before extraction unless the exact routed model declares image input. Complete Office or OFD page rendering, OCR, charts, SmartArt, vectors, media, animations, and embedded objects remain explicit limitations rather than inferred content.

Digital-invoice XML is accepted only when recognized fields include an invoice number, one transaction party, and an amount. Common tax-delivery names and Ministry of Finance XBRL names map to stable Chinese labels. OFD parsing reads ordered page text and page-referenced pictures and scans package XML or XBRL parts for the same recognized invoice fields. PDF delivery uses the shared PDF text-and-picture route. Every recognized digital invoice result states that parsing does not verify signatures, authenticity, invoice status, deductions, or booking state.

The normalized record retains schema version `3` and uses normalizer version `4` below `$DSH_HOME/finance/documents/v3/normalizer-v4/<scope-hash>/`. Earlier normalizer records and schema version `1` or `2` cache files remain untouched because they are derived data and can be regenerated from authorized source records. Finance clients, Finance consultations, and ordinary sessions use separate hashed scopes.

## Alternatives considered

- **Copy the Finance parser into a new ordinary-mode package.** Rejected because fixes, format support, limits, and security checks would diverge.
- **Expose the Finance tool globally.** Rejected because its authorization depends on Finance events and customer context and would misrepresent ordinary uploads.
- **Accept a local path passed by the model.** Rejected because conversation text is not source authorization and would allow arbitrary or cross-session reads.
- **Render every Office, PDF, and OFD page.** Rejected because it requires Office rendering runtimes, increases package size and latency, and duplicates the direct text path. The adopted PDF route renders only text-poor pages with a local PDF runtime; direct text remains authoritative elsewhere.
- **Treat every XML file as an invoice.** Rejected because unrelated configuration and export XML would be projected into financial fields. Recognition requires independent invoice identity, party, and amount evidence.
- **Call an external invoice parser or verification API.** Rejected because local document reading must work without another credential or data transfer. Authenticity and status verification remain explicit separate capabilities.
- **Keep ordinary modes on ad-hoc tools.** Rejected because behavior remains slow, machine-dependent, and inconsistent with Finance.

## Verification

Parser tests cover complete scanned-page rendering, mixed PDF page selection, embedded-picture relationships and source locations for PDF, DOCX, XLSX, PPTX, and OFD, exact re-extraction, byte limits, image-only documents, official-style XBRL field names, OFD-embedded XBRL, unrelated XML rejection, and the existing text formats. A real isolated Worker test renders and re-extracts a minimal scanned PDF. Ordinary-source tests cover current-session human uploads, plugin-authored text, outside-root paths, missing roots, and duplicate references. Client routing tests prove a known non-Finance upload performs neither a Finance RPC nor a second upload. Tool tests prove native image content blocks, visual locators, and invoice verification disclaimers.

Keyless assembled snapshots boot the Xiaojing Standard and Finance presets. The Standard snapshot proves `document_reader` can list and read a durable ordinary upload while `finance_document` is absent. Finance snapshots prove `finance_document` still reads customer and consultation imports while `document_reader` is hidden. The package TypeScript program compiles under the repository strict configuration.

## Consequences

Every Xiaojing preset has predictable local document reading through the existing upload button, while Finance retains stronger customer-specific authorization. Scanned and mixed PDFs combine deterministic text extraction with bounded complete-page visual inspection; DOCX, XLSX, PPTX, OFD, and text-rich PDF pages retain bounded supported embedded pictures. Recognized digital-invoice XML and OFD expose structured fields without overstating verification. OCR, complete Office or OFD page rendering, legacy Office formats, charts, SmartArt, signature validation, official invoice lookup, and semantic finance interpretation remain separate capabilities.
