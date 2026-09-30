---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-30-xiaojing-finance-rc2

English | [中文](2026-09-30-xiaojing-finance-rc2.zh.md)

## Summary

Acknowledge five existing Xiaojing Finance event types alongside the RC2 persistence inventory.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-30-xiaojing-finance-rc2
baseline: false
changes:
  - root: "event:finance/client-bound"
    previous: null
    after: "4bceb77c2d8f71452bfc9e8553dc01a01b420db4448850559dfdebbb043871fc"
    decision: same-version
  - root: "event:finance/consultation-file-imported"
    previous: null
    after: "1f00f2e604e8825c99b6bfbc82639f853153632af1e782a1d3ef170ac0d3485a"
    decision: same-version
  - root: "event:finance/file-archived"
    previous: null
    after: "ced60f250857daa57c76493125bd680b1bf04515f68e78037e70c6f3bd644dd6"
    decision: same-version
  - root: "event:finance/file-imported"
    previous: null
    after: "2a6e99d971a77f4f026b78e3b999a131f5525f03b5f4b8ce2fff636672973b83"
    decision: same-version
  - root: "event:finance/file-published"
    previous: null
    after: "ba4b06e4dc224e5fbf89ef28483756fdd150d59a9557812251a291eae639c9c2"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

These product events already exist in the Xiaojing integration and retain their fields and semantics. They are additions relative to the official Harness acknowledgement history. No committed Session generation is rewritten or removed. Finance readers must include the product event declarations; the official-only build does not promise to read these product-specific events. Existing writer/header migration remains owned by the released Harness migration chain.

<a id="verification"></a>
## Verification

pnpm exec vitest run selected Xiaojing Finance packages and adjacent product services: 122 files and 2103 tests passed. Catalog extraction reports only these five added roots and no SessionHeader version change.

<a id="dev-note"></a>
## Dev Note

None.
