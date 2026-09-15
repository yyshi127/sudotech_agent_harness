# Agent Note: Finance balance report evidence

Status: implemented

English | [中文](2026-09-07-finance-balance-query.zh.md)

## Problem

The live balance endpoint returns subject rows and summaries with `count: 0`. Blank monetary cells, negative debit balances, and unstable numeric summary identifiers prevent applying the voucher-list projection or conventional net-balance assumptions.

## Decision

The Finance-only query uses the existing saved-credential and session-binding checks. It verifies the authorized ledger ID, applies row and byte limits, separates rows with empty subject codes into summaries, preserves decimal strings and signs, and maps blank monetary cells to null. It excludes vendor-generated summary identifiers. Coverage remains explicitly unverified because the response count cannot establish completeness.

The live endpoint formats four-digit opening balances as `1,000.00`. The amount parser validates either an ungrouped decimal or complete three-digit groups before removing commas as text. Malformed grouping remains an error; precision and blank-value behavior are unchanged. Result notices and tool instructions forbid treating blank movements or equal opening/closing amounts as evidence of no activity, including in prose summaries.

The answer instructions apply missing-value labels to summaries as well as subject rows, preserve debit/credit terminology, and forbid inferring transfers from matching amounts or adding unverified arithmetic. A disclaimer does not excuse a contradictory table or conclusion. Prompt assertions protect these instructions, while live-answer checks remain necessary because generated prose is not deterministically validated.

An optional exact subject level maps to identical documented start/end levels. Explicit ranges use bounded parent traversal under one authorization and deadline. Supplier confirmation establishes that nonpagination alone does not retrieve all descendants; the initial level is followed by child requests keyed by `parentSubjectId`, with `hasChild` controlling expansion through the end level. Only initial summaries survive. Duplicate IDs/codes, wrong parents, absent advertised children and combined limits reject the operation. This replaces the disproved assumption that a flat nonpaged range is sufficient; root completeness remains unverified. Query results and workbooks retain the selection and unavailable values.

Cross-source discrepancy claims require comparable account mappings, currencies, periods, populations and accounting states. Separate journal labels prevent a shared opening/closing table from implicitly asserting that equivalence. Unqualified sources remain not yet reconciled; their differing values alone do not establish an error or synchronization cause.

## Alternatives considered

**Tool instructions alone.** The general analysis skill also guides mixed-query answers. Its requirement to explain formulas needs an explicit distinction between quoting source amounts and performing requested calculations. The skill preserves query-tool field meanings and requires verified calculation results; the assembled scenario loads both sources. This remains instruction-level protection, not a guarantee that generated prose complies.

The optional XLSX export preserves this projection without inferring totals or currency. Separate sheets prevent mixing subject and summary rows; null uses an explicit missing-value label rather than a numeric zero. Literal string cells retain decimal precision and reject oversized values instead of truncating them. Publication reuses the tracked Finance file operation and records the exact source digest. Export acceptance is distinct from financial-completeness acceptance.

**Infer totals and net balances.** Summing every returned row duplicates parent balances and vendor summaries. Treating blanks as zero or moving negative debits to credits asserts financial semantics not established by the response.

**Separate query framework.** A separate query framework adds no value to this single read operation.

**Strip arbitrary commas or parse floating-point values.** Unconditional stripping silently accepts malformed amounts; floating-point conversion can lose precision. Format validation precedes lossless text normalization.

## Consequences

Query reconciliation identifies Xiaojing as its verification owner; the source workbook preserves the identifier. Live count acceptance exposed ambiguous attribution to the vendor interface, so the notice distinguishes vendor amounts from locally computed checks.

The Host enriches ordinary explicit single-month root queries with shared reconciliation and counts. This removes model selection of the analysis flag as a prerequisite for obtaining program checks, without changing provider requests. Enrichment occurs inside the saved-configuration read and rechecks the complete byte limit. Child/range queries are not promoted; source nulls and coverage remain unchanged. A root-query assembled scenario covers the raw-tool path.

Tool parameter guidance routes total checks to analysis. A fresh live conversation otherwise selected raw queries and counted twelve source fields; an existing conversation retained an earlier incorrect count despite receiving correct counts. The result instructions distinguish eight checked debit/credit fields from four source-only Balance fields and require correcting conflicting historical prose. These are routing and answer instructions, not deterministic generation guarantees.

The result computes status counts across eight columns per period. Instructions require final summaries to use them because live acceptance observed a correct four-row matched table summarized as six. Counts are tested against individual statuses; generated wording still requires live acceptance.

Root-level analysis compares the sum of provided values with a unique `本期合计` for each debit/credit column. It retains missing-cell counts and distinguishes matched, mismatched, unavailable and unsupported-level results. The workbook publishes these checks separately. A match does not establish row completeness or individual blank-as-zero semantics; source nulls and unverified coverage remain unchanged. Focused tests cover conflicting and duplicate totals, missing amounts and child-only selections.

Live model acceptance exposed a redundant `monthEnd` equal to `month`. The consumer accepts equivalent endpoints but still rejects a genuine multi-month range before reads or publication; assembled scenarios cover both paths. This avoids a needless retry without interpreting an ambiguous range as a single month.

Requested comparisons use one explicit level and base-currency requests rather than summing an arbitrary tree. Stable subject IDs align months; changed codes, names or parents reject comparison. Integer cents retain precision, and absent rows or amounts never contribute fabricated zeros. Eight debit/credit columns support differences and qualified returned-row sums; unsigned balance fields remain source-only. Source reports, scope and limitations accompany the analysis workbook. This implements bounded arithmetic, not independently verified whole-ledger completeness.

Range results retain subject and parent IDs and reject duplicate IDs, missing interior parents, contradictory child flags and missing advertised children within the requested depth. Vendor summary IDs remain excluded because they are not stable subject identifiers. Structural consistency is narrower than vendor completeness: an omitted sibling or unrelated root cannot be ruled out by these checks alone.

Focused tests cover bounds, malformed/grouped money, duplicate subjects, ledger authorization, transport errors and secret rejection. Assembled Web scenarios exercise the shipped Finance preset, durable output, rendered cards and exports. Authorized test openings in ledger 35601 balance debit 1000 on 110101 against credit 1000 on 3001; January, August and September parent reports agree with the UI. The actual September workbook preserves four subjects, three summaries and every amount column. A separate public query retrieves child 110101 using the parent ID, while the default query returns its parent only. This qualifies these samples, not complete hierarchy retrieval, currency semantics or overall accounting-report acceptance. Test seeding remains outside the product.
