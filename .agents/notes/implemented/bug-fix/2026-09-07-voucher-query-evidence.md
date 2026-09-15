# Agent Note: Voucher query evidence and bounds

Status: implemented

English | [中文](2026-09-07-voucher-query-evidence.zh.md)

## Problem

Voucher queries filter accounting periods but return voucher dates. Treating those as interchangeable rejects valid responses without proving the filter. Short non-final pages can skip vouchers, and client revisions alone do not detect direct credential replacement.

## Decision

Essential cross-source comparison and missing-field rules are contributed by the bound Finance prompt listener on every request. Optional analysis-skill discovery cannot guarantee their delivery during ordinary mixed queries. A first-request snapshot through the shipped preset covers delivery without a skill call; scoped assembly tests exclude standard and consultation sessions and verify disposal. This establishes instruction delivery, not real-model semantic acceptance.

Unverified comparisons establish neither normality nor abnormality, including in test ledgers. Introductory statements and final conclusions follow the same rule; a disclaimer does not repair an unsupported earlier judgment. Missing values and coverage limitations remain specific to each source. Negative debit or credit values retain their returned column rather than being interpreted as the opposite balance side.

The shared read adapter retains only fixed, allowlisted transport cause codes in query diagnostics. Category-only `network` hides the distinction between a reset, DNS failure and connection timeout; raw exception messages can contain credentials. Unrecognized codes remain generic. Host configuration enables one retry for recognized transient transport failures using the same request and original deadline; HTTP/vendor failures, permanent DNS failure, unknown errors and invalid responses do not qualify. A real level-two balance query fails with `UND_ERR_CONNECT_TIMEOUT` during authentication and succeeds on a subsequent query. Bounded retries handle that failure class without claiming to repair the underlying network. Connection-status enums remain unchanged.

The existing list tool validates exact page lengths against the reported total, rejects extra query fields, bounds every raw response, and rechecks credentials before publishing. Decimal strings remain authoritative; numeric amounts outside safe cent precision fail. A logged notice distinguishes period filters, voucher dates, page counts, and unverified period coverage.

Period ranges and summary text map only to documented list parameters. Results retain requested filters and all returned entries rather than locally removing unmatched lines from a balanced voucher. The tool does not claim the vendor's matching behavior is verified by request-mapping tests.

## Alternatives considered

Inferring periods from dates or silently accepting short pages gives unsupported completeness guarantees. A new query framework is unnecessary for these fixes. The vendor's summary filter cannot substitute for semantic interpretation: a live query for “取现” misses “银行提现”. Tool guidance keeps paraphrases out of that filter. Three authorized standalone test vouchers establish the real detail debit fields without adding voucher creation to the product.

## Consequences

Real application queries identify the withdrawal voucher from paraphrased wording and resolve “the previous one” through the detail tool. Live pagination also produces intermittent `query-failed` errors before succeeding; their original cause is not established by later successful reads. Stage-specific categories distinguish transport failures from projection rejection without exposing raw exceptions. This diagnostic correction is not proof that the intermittent failure is fixed; stability acceptance remains open.

The detail tool shares session ownership and stale-credential checks with the list tool, validates returned ledger and voucher IDs, and projects verified decimal amounts, period, maker, and statuses. Attachment, auxiliary, and foreign-currency details remain explicitly excluded. Account 35601 read-only checks verify two nonempty pages, an out-of-range page, period ranges, summary samples, and three detail identities. An out-of-range page reports zero total even with three existing vouchers; a bounded result notice prevents treating that as an empty ledger. Focused tests and shipped-preset Web scenarios cover projection and list-to-detail execution; mock model calls are not evidence of semantic understanding. Real application checks establish paraphrased lookup, contextual detail selection, and multiple candidates; the functional acceptance and separate stability issue are recorded in the [development status](../../../../docs/integrations/youcheng-finance-development-status.md).
