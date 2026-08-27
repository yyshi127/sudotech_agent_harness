---
name: china-tax-official-research
description: Use for Chinese finance, tax, invoice, accounting-policy, filing, deduction, preferential-treatment, or tax-risk questions that require a current and verifiable rule. Search official sources, establish jurisdiction, taxpayer facts and the relevant period, then answer with authority, effective dates, applicability, risks, document numbers and direct official links.
whenToUse: Questions whose answer may change with Chinese tax law, accounting policy, locality, taxpayer type, transaction facts, or tax period.
user-invocable: true
---

# Researching Chinese finance and tax rules

Use this skill to answer rule-dependent Chinese finance and tax questions. It provides a verification workflow, not a local regulation database, legal opinion, filing service, or guarantee that a tax authority will accept a treatment.

## Establish the question before researching

Identify the following facts when they can change the answer:

- jurisdiction and locality;
- taxpayer or entity type, industry, and relevant qualification;
- transaction, document, counterparty, and amount facts;
- accounting standard or reporting framework;
- accounting period, tax period, transaction date, and the date as of which the answer is requested;
- whether the user needs an explanation, a calculation, an accounting treatment, filing guidance, or a risk review.

Ask only for material missing facts. If several common fact patterns lead to different answers, state each branch instead of silently selecting one.

## Research only from attributable official sources

Use `web_search` for current or date-sensitive claims. Search with exact policy titles, document numbers, dates, tax types, and the relevant locality. Prefer direct documents over summaries and use this authority order:

1. Laws and administrative regulations published through the National Laws and Regulations Database (`flk.npc.gov.cn`) or the Chinese Government website (`gov.cn`).
2. Formal tax and accounting documents from the State Taxation Administration policy database (`fgk.chinatax.gov.cn`, `chinatax.gov.cn`) and the Ministry of Finance (`mof.gov.cn`, including its accounting and tax-policy departments).
3. Applicable provincial or municipal government and tax-authority documents on verified official government domains.
4. Official interpretations, service guidance, Q&A, and news releases. Treat these as explanatory material, not a substitute for a binding rule.
5. Commercial articles, social posts, search summaries, and professional commentary may help discover a document but never serve as the primary authority for a conclusion.

A `.gov.cn` suffix alone does not prove that a page governs the user's case. Confirm the issuing authority, document title, document number when one exists, publication date, effective date, territorial reach, and current status. Search for amendments, repeal or invalidation lists, transition rules, and later documents that cite or replace the candidate rule.

Do not present a search snippet as if it were the complete provision. If the available official result does not expose enough text to support the conclusion, say what remains unverified and avoid a definitive answer.

## Classify every material authority

For each rule that affects the conclusion, distinguish:

- legal effect: law, administrative regulation, departmental rule, normative document, local rule, or explanatory guidance;
- time status: effective, not yet effective, amended, repealed, expired, transitional, or not verified;
- relevance: directly applicable, applicable only if stated conditions hold, analogous but not controlling, or background only.

Never combine a historical rate, a future rule, and a current rule without labeling their periods. Do not infer that an incentive continues merely because an old official page remains online.

## Produce an auditable answer

Use the user's language. For a substantive answer, include these sections unless the question is simple enough to combine them without losing a required fact:

1. **结论** — answer directly and state the date through which the rule was checked.
2. **适用前提** — jurisdiction, entity or taxpayer type, transaction facts, period, and any assumptions.
3. **依据与判断** — explain how each controlling rule applies; separate confirmed facts from inference.
4. **操作建议与风险** — list the practical treatment, evidence to retain, unresolved points, local-calibre differences, and conditions requiring confirmation with the competent authority or a licensed professional.
5. **官方依据** — provide a compact table with issuing authority, policy title, document number, publication/effective date, status, and a direct official Markdown link.

Use `待核验` for a material proposition whose official source, current effect, or applicability cannot be established. Do not invent document numbers, article numbers, quotations, effective dates, rates, thresholds, filing deadlines, or links. Do not say that filing, payment, posting, approval, or another external action has completed unless a tool result verifies the final state.

## Stop conditions

- If the jurisdiction is outside mainland China, state that this workflow does not establish the applicable foreign, Hong Kong, Macao, or Taiwan rule and ask whether the user wants jurisdiction-specific research.
- If official sources conflict, show the conflict and authority levels; do not choose the more favorable answer without support.
- If a local implementation rule is material but cannot be verified, provide only the national rule and label the local treatment `待核验`.
- If the question could create a material filing, penalty, criminal, audit, or transaction risk, explain the verified rule and recommend confirmation with the competent tax authority or an appropriately licensed professional before action.
