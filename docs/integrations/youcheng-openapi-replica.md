# Youcheng OPENAPI source snapshot

English | [中文](youcheng-openapi-replica.zh.md)

## Scope and source

The [structured snapshot](youcheng-openapi-replica.json) and [readable source extract](youcheng-openapi-replica.source.txt) preserve supplier documentation from share `7YX0lXxR`. The extract records its retrieval time, source URL, document identifiers and failures. It contains the reimbursement-oriented catalog, not the separate V2 Finance catalog; see the [capability mapping](youcheng-capability-implementation-matrix.md) for that distinction. A saved example is not proof that an endpoint is available or that a product operation succeeded.

## Maintenance

The [replication script](../../scripts/replicate-youcheng-openapi.mjs) reads the supplier documentation service and replaces only the JSON snapshot and source extract. It does not execute business requests. The extract preserves the generator's Markdown-like formatting as source data; it is not a maintained English reference or a reviewed translation. This bilingual page owns its scope and maintenance instructions and is not overwritten by the script.
