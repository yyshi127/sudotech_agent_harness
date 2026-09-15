# Agent Note: Currency-separated deletion balance evidence

Status: implemented

English | [中文](2026-09-14-open-item-deletion-balances.zh.md)

## Problem

Public AR/AP records provide original balances and currency codes but can omit base balances. Requiring every base balance hides otherwise verifiable original-currency deletion effects. A matching total alone can also hide offsetting changes to surviving records.

## Decision

Deletion recovery reports original and base evidence separately. Each requires unchanged surviving amounts and exact per-currency equality between the original sum minus the deleted record's balance and the observed sum. Integer minor units preserve precision. A counted empty result after deleting the last record sums to zero; an absent amount in an existing row never does. These sums cover the captured direction and periods, not whole-account totals or bank movements.

Missing base balances use original balances only when nonempty original and base currency codes match. Results label reported, same-currency-derived, mixed or unavailable evidence without modifying stored rows. Conflicting reported balances for identical currencies fail comparison. Missing FX conversion evidence leaves base verification unavailable while retaining valid original evidence. Record identities, complete inventory checks, transport outcomes, exact consent and no-resend claims remain independent.

## Alternatives considered

**Ignore base balances entirely.** Rejected because known discrepancies and missing FX conversion must remain visible.

**Fill missing vendor fields or query an exchange rate.** Rejected because neither preserves the actual returned record or its historical conversion basis. Same-currency evidence is labeled in the comparison, not inserted into vendor data.

## Consequences

Both AR and AP tests cover derived balances, exact deltas, missing FX values, changed surviving amounts and unknown transport outcomes. Real assembled Web scenarios retain refusal, version binding, one write and read-only recovery while displaying the separate evidence. Historical receipts remain immutable; independent re-evaluation records the current comparator separately. No additional delete request, exchange-rate API, database migration or new permission is introduced.
