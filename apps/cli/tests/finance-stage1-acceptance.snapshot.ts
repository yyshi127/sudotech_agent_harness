import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/finance-documents/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

describe('Xiaojing Finance Stage 1 assembled acceptance', () => {
  it('keeps Standard capabilities while isolating two client contexts, files, and calculations', async () => {
    const result = await runLoaderSmoke({
      label: 'Xiaojing Finance Stage 1 acceptance snapshot',
      tempDirPrefix: 'xiaojing-finance-stage1-acceptance-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: ['--stage1-acceptance'],
      tsconfigPath,
      env: { DSH_CLIENT_BUILD_PROFILE: 'xiaojing' },
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS * 3,
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "capabilityParity": {
          "financeOnlySkills": [
            "finance-data-analysis",
            "finance-document-reading",
            "finance-invoice-review",
            "finance-reimbursement",
            "finance-tax-research-cn",
            "finance-voucher-draft",
          ],
          "financeOnlyTools": [
            "finance_calculation",
            "finance_document",
            "finance_evidence",
            "finance_files",
          ],
          "standardHasFinanceTools": false,
        },
        "clientIsolation": {
          "clientAHasOnlyOwnContext": true,
          "clientAHasOnlyOwnDocument": true,
          "clientBHasOnlyOwnContext": true,
          "clientBHasOnlyOwnDocument": true,
          "crossClientReadsRejected": true,
        },
        "deterministicCalculations": {
          "generalVatUsesBoundClient": true,
          "smallScaleVatUsesBoundClient": true,
        },
        "documentTraceability": {
          "clientAReadHasSourceLocation": true,
          "clientBReadHasSourceLocation": true,
          "sameSourceHash": "792afd0b6d9c0a1c4001cecbffb63c2c360da9dfd6b3fa910d34d4d2efd512a0",
          "separateStoragePaths": true,
        },
        "jurisdictionSafety": {
          "unsupportedLocalityRefused": true,
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 3)
})
