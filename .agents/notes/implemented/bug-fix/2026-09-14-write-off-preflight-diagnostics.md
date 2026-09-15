# Agent Note: Write-off preflight diagnostics

Status: implemented

English | [中文](2026-09-14-write-off-preflight-diagnostics.zh.md)

## Problem

A reserved write-off can fail before dispatch while re-reading evidence, checking identity or running the final Host callback. A generic not-sent result loses the last check reached, making later diagnosis impossible even when no write occurred.

## Decision

The reserved sender records a bounded `preflightStage` only in not-sent outcomes. The record store validates and retains it through reload and inspection. Stages identify checks, not vendor root causes: `final-confirmation` names the final Host callback after consent, not a claim that the user refused. No credentials, raw vendor messages, arbitrary diagnostic text or retry permission are added. Accepted and uncertain outcomes remain unchanged. Older not-sent records without the optional stage remain readable; their missing history is not reconstructed from later observations.

## Alternatives considered

**Persist raw exceptions.** Rejected because request and vendor errors can contain credentials or unrelated financial data; the last local check is sufficient for a narrower investigation.

**Retry an old failed operation to diagnose it.** Rejected because later state is not the original evidence and a diagnostic change must not reopen a consumed intent. A separately confirmed new proposal retains the existing eligibility rules.

## Consequences

Transport tests verify bounded stages and zero writes on failures. Durable-record tests preserve both old and staged outcomes without reopening them. Assembled Finance scenarios cover both directions failing during the reserved source read, displaying the stage, retaining the original result and refusing duplicate dispatch. The stage narrows investigation; it does not retrospectively establish why an older generic failure occurred.
