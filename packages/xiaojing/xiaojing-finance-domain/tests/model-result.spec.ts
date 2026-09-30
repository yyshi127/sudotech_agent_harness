import { describe, expect, it } from 'vitest'
import { financeModelCall, financeModelJson } from '../src/model-result.ts'

describe('Finance model result projection', () => {
  it('retains business and continuation fields while removing internal evidence recursively', () => {
    const visible: unknown = JSON.parse(financeModelJson({
      id: 'local-operation', version: 2, accountName: '演示账套', voucherCount: 53,
      pageSize: 20, pagesRead: 3, notice: 'internal explanation', fingerprint: 'digest',
      file: { path: 'D:/成果/全部凭证.xlsx', name: '全部凭证.xlsx', sha256: 'hash', size: 4096 },
      readback: { complete: true, sourceQuery: { page: 1 }, coverage: 'vendor-count-reconciled' },
    }))

    expect(visible).toEqual({
      id: 'local-operation', version: 2, accountName: '演示账套', voucherCount: 53,
      file: { path: 'D:/成果/全部凭证.xlsx', name: '全部凭证.xlsx' },
      readback: { complete: true },
    })
  })

  it('removes persisted JSON previews after the business preview has been shown', () => {
    expect(JSON.parse(financeModelJson({
      preview: JSON.stringify({ detail: { accountName: '测试账套', notice: '内部说明' }, fingerprint: 'secret' }),
    }))).toEqual({})
  })

  it('hides low-level failure codes but preserves business validation', async () => {
    await expect(financeModelCall(async () => { throw new Error('有成凭证查询失败（invalid-response）') }))
      .rejects.toThrow('财务操作未完成，请检查帐套连接、有成财务权限和网络后重试。')
    await expect(financeModelCall(async () => { throw new Error('有成凭证查询失败（network；阶段：凭证列表请求）') }))
      .rejects.toThrow('财务操作未完成，请检查帐套连接、有成财务权限和网络后重试。')
    await expect(financeModelCall(async () => { throw new Error('借贷金额不平衡。') }))
      .rejects.toThrow('借贷金额不平衡。')
  })
})
