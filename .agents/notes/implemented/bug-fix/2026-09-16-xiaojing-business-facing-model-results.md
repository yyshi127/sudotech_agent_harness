# Agent Note: Business-facing model results

Status: implemented

English | [中文](2026-09-16-xiaojing-business-facing-model-results.zh.md)

## Problem

Xiaojing tools could return internal evidence directly to the model even when the browser card already displayed a concise business result. Finance results included collection metadata, diagnostics and storage receipts; some tool descriptions explicitly asked the model to report internal states. A successful task could therefore end with retry history, pagination mechanics, checksums, byte counts, field names and test commentary instead of the requested deliverable. Ordinary and Weixin sessions had no shared product-level response rule.

## Decision

Every Xiaojing preset receives one stable business-facing response policy. Successful answers lead with the usable outcome and omit failed-attempt narration. Failures state the user-visible effect, a known plain-language reason and one practical next action. Generated files are delivered by content and usable location. Material limitations remain visible only when they change interpretation, safety or the next action.

All Finance tools now project model-visible results separately from durable Host records. The projection retains business data and continuation identifiers needed for a later confirmed action while removing diagnostic, collection, checksum, byte-count and test metadata recursively. Low-level transport and response-validation errors become one actionable Finance failure before reaching the model; business validation errors remain specific. Tool descriptions use business language rather than requiring reports of internal state names.

The Weixin file-send result and visualization result no longer expose byte counts to the model. Browser and Windows-control results keep opaque page, window and target identifiers because the model needs them for the next automation action; the product-wide policy prevents those operational identifiers from becoming the final user answer. Finance evidence, deterministic calculations and document reading retain source locations, assumptions, calculation steps and material parser warnings because those are part of the requested business evidence rather than implementation diagnostics.

## Alternatives considered

**Rely on a final-answer prompt only.** Rejected because raw evidence remains highly salient and model compliance is probabilistic. The source result must also be projected.

**Remove all identifiers and status fields.** Rejected because confirmed writes, recovery, document continuation and browser automation require opaque continuation values. They remain model-visible only where the next action needs them.

**Rewrite every framework tool.** Rejected because the defect is in Xiaojing product composition and Xiaojing-owned tools. Product-wide policy plus local projections fixes the owned surface without changing unrelated Harness behavior.

## Consequences

Host logs and durable records retain complete recovery and audit evidence, while model context is smaller and less likely to echo implementation details. Technical diagnostics remain available when explicitly requested. A prompt cannot provide an absolute output guarantee, so keyless assembled snapshots continue to verify representative final answers and tool-result projections.

## Verification

Unit tests cover the product-wide prompt, recursive Finance result projection, low-level error sanitization, Finance tool behavior, Weixin file receipts and visualization receipts. Finance Web snapshots exercise the shipped preset and verify business-facing exports and operation results without internal collection metadata.
