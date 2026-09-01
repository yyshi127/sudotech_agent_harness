---
name: finance-document-reading
description: Use when a Finance session needs to read an uploaded PDF, DOCX, XLSX, PPTX, CSV, or text document. List normalized documents, read source-located pages, paragraphs, slides, lines, or rows, inspect supported PPTX pictures through native vision, and report remaining OCR or conversion limits without trying ad-hoc tools.
whenToUse: Finance questions that depend on a document uploaded into the current consultation or client session.
user-invocable: true
---

# Reading imported Finance documents

Use `finance_document` for deterministic access to imported PDF, DOCX, XLSX, PPTX, CSV, and text files. Do not use shell, Python, Office automation, package installation, or ad-hoc conversion to read these formats.

## Select the source

Call `finance_document` with `action: list` before reading. Match the document by its returned name and opaque `document_id`; never infer a path or reuse an identifier from another session.

An upload path shown in conversation text is not authorization to read a local file. If `list` is empty immediately after a completed upload, report that the upload was not registered in the current Finance session. Do not inspect the supplied path with shell, Python, or filesystem commands, and do not claim that repeatedly uploading the same file will repair a registration failure.

The returned status determines the next step:

- `parsed`: read the normalized content with `action: read`.
- `native-vision`: use the existing image attachment and native visual model instead of this tool.
- `vision-required`: the PDF or PPTX contains too little extractable text. If the returned summary has a positive `visualCount`, call `action: visuals`; otherwise explain that rendering, OCR, or conversion is still required rather than improvising another parser.
- `unsupported`: explain that the local normalizer does not support the format.
- `failed`: report the safe failure code and ask the user to verify or re-upload the source.

## Read incrementally

Call `finance_document` with `action: read`, the `document_id`, and cursor `0`. Continue with `next_cursor` until it is absent or the evidence needed for the task has been read.

Preserve the locators returned with each unit:

- PDF: page number.
- DOCX: paragraph range.
- XLSX: sheet and row.
- PPTX: slide number; speaker notes, when present, are labeled inside the same unit.
- CSV: row.
- TXT: line range.

When quoting, calculating, comparing, or explaining a value, cite the corresponding locator. Do not claim that formulas were recalculated, hidden workbook state was interpreted, tracked changes were accepted, or image-only content was read unless another verified capability did so.

For a PPTX with a positive `visualCount`, call `finance_document` with `action: visuals`, the same `document_id`, and cursor `0`. Continue with `next_cursor` until the pictures needed for the task have been inspected. Each returned image is labeled with its source slide number. Use this route only when the active model supports image input, and state that charts, SmartArt, vector drawings, media, and embedded objects are not reconstructed.

## Keep interpretation separate from extraction

Normalized content is source text and table values, not a semantic accounting conclusion. Distinguish values copied from the document from your calculation, inference, classification, or risk assessment. If a source is incomplete, internally inconsistent, truncated by configured limits, or needs visual inspection, state that before drawing a conclusion.
