import { describe, expect, it } from 'vitest'
import { financeApprovalReason } from '../src/approval-presentation.ts'
import { financeResultContent } from '../src/result-presentation.ts'

const content = (value: unknown) => [{ type: 'text', text: JSON.stringify(value) }]

describe('finance result presentation', () => {
  it('shows voucher business results without exposing the model JSON or technical evidence', () => {
    const visible = financeResultContent(content({
      accountId: '35616', accountName: '演示账套', month: '2026-09', page: 1, pageSize: 20,
      total: 2, hasMore: true, voucherCount: 2, rows: [{ voucherId: '1' }, { voucherId: '1' }],
      notice: 'internal notice', fingerprint: 'secret-digest',
    }), false, 'voucher-list')[0]!.text

    expect(visible).toContain('账套：演示账套')
    expect(visible).toContain('凭证：2 张；分录：2 行')
    expect(visible).toContain('还有下一页')
    expect(visible).not.toContain('accountId')
    expect(visible).not.toContain('fingerprint')
    expect(visible).not.toContain('internal notice')
  })

  it('shows exported business scope and file location without hashes', () => {
    const visible = financeResultContent(content({
      report: { accountName: '演示账套', month: '2026-09', monthEnd: '2026-09', rows: [], summaries: [] },
      file: { name: '科目余额.xlsx', path: 'D:/成果/科目余额.xlsx', sha256: 'digest', size: 100 },
    }), false, 'balance')[0]!.text

    expect(visible).toContain('导出文件：科目余额.xlsx')
    expect(visible).toContain('保存位置：D:/成果/科目余额.xlsx')
    expect(visible).not.toContain('sha256')
  })

  it('shows one complete voucher export from its business-only receipt', () => {
    const visible = financeResultContent(content({
      accountName: '演示账套', month: '不限月份', voucherCount: 53, rowCount: 106,
      exportFile: { name: '全部凭证.xlsx', path: 'D:/成果/全部凭证.xlsx' },
    }), false, 'voucher-list')[0]!.text

    expect(visible).toContain('凭证：53 张；分录：106 行')
    expect(visible).toContain('导出文件：全部凭证.xlsx')
    expect(visible).not.toMatch(/pageSize|pagesRead|sha256|notice/)
  })

  it('shows saved files without storage receipts', () => {
    const visible = financeResultContent(content({
      action: 'publish', name: '凭证.xlsx', path: 'D:/成果/凭证.xlsx',
      sha256: 'digest', size: 2048, sourcePreserved: true,
    }), false, 'file')[0]!.text

    expect(visible).toBe('财务成果已保存\n文件：凭证.xlsx\n位置：D:/成果/凭证.xlsx')
    expect(visible).not.toContain('sha256')
    expect(visible).not.toContain('2048')
    expect(visible).not.toContain('sourcePreserved')
  })

  it('summarizes prepared and completed operations without IDs, versions or raw state names', () => {
    const prepared = financeResultContent(content({ id: 'local-id', version: 3, phase: 'prepared',
      account: { id: '35616', name: '演示账套' }, input: { direction: 'receivable', date: '2026-09-15', amount: '88.00', summary: '服务费' },
      fingerprint: 'digest' }), false, 'operation')[0]!.text
    expect(prepared).toContain('状态：已准备，等待确认')
    expect(prepared).toContain('业务类型：应收')
    expect(prepared).toContain('金额：88.00')
    expect(prepared).not.toContain('local-id')
    expect(prepared).not.toContain('version')
    expect(prepared).not.toContain('fingerprint')

    const limited = financeResultContent(content({ preview: { direction: 'payable', target: { amount: '19.00' } },
      execution: { state: 'unavailable', reason: '资金账户配置待确认' } }), false, 'operation')[0]!.text
    expect(limited).toContain('业务类型：应付')
    expect(limited).toContain('原因：资金账户配置待确认')

    const completed = financeResultContent(content({ phase: 'accepted', complete: true,
      outcome: { state: 'accepted', voucherId: '240001' } }), false, 'operation')[0]!.text
    expect(completed).toContain('状态：已完成并核对')
    expect(completed).not.toContain('240001')
    expect(completed).not.toContain('accepted')
  })

  it('keeps actionable business errors without machine prefixes or codes', () => {
    expect(financeResultContent([{ type: 'text', text: 'Error: 帐套连接失败' }], true, 'balance'))
      .toEqual([{ type: 'text', text: '帐套连接失败' }])
    expect(financeResultContent([{ type: 'text', text: 'Error: 有成凭证查询失败（query-failed），请检查帐套连接、接口权限和网络' }], true, 'voucher-list'))
      .toEqual([{ type: 'text', text: '有成凭证查询失败，请检查帐套连接、有成财务权限和网络' }])
    expect(financeResultContent([{ type: 'text', text: 'Error: 有成凭证查询失败（network；阶段：凭证列表请求）。本次未取得有效结果，不代表没有凭证；不能仅凭此错误判定是配置或有成服务故障。不要通过文件搜索或索取密钥代替查询。' }], true, 'voucher-list'))
      .toEqual([{ type: 'text', text: '有成凭证查询失败。本次未取得有效结果，不代表没有凭证。' }])
    expect(financeResultContent([{ type: 'text', text: 'Error: /finance/certificate/list.rjson pageSize 参数错误' }], true, 'voucher-list'))
      .toEqual([{ type: 'text', text: '财务操作未完成，请检查帐套连接、有成财务权限和网络后重试。' }])
  })
})

describe('finance approval presentation', () => {
  it('shows a complete voucher in business language without local IDs or storage configuration', () => {
    const reason = financeApprovalReason('create-voucher', {
      id: 'local-id', version: 2, account: { id: '35616', name: '演示账套' },
      input: { date: '2026-09-15', certificateCode: 6, documentMaker: '施', sourcePaths: ['发票.pdf'], entries: [
        { side: 'debit', subjectCode: '6602', amount: '100.00', summary: '办公费' },
        { side: 'credit', subjectCode: '100201', amount: '100.00', summary: '办公费' },
      ] },
      totalDebit: '100.00', totalCredit: '100.00', references: [
        { subject: { name: '管理费用' } }, { subject: { name: '银行存款' } },
      ],
    }, { attachmentsWillUpload: true })

    expect(reason).toContain('账套：演示账套')
    expect(reason).toContain('1. 借 6602 管理费用 100.00')
    expect(reason).toContain('附件：1 个原件将先上传')
    expect(reason).not.toContain('local-id')
    expect(reason).not.toContain('version')
    expect(reason).not.toContain('bucket')
    expect(reason).not.toContain('{')
  })

  it('states deletion and write-off effects without fingerprints or source queries', () => {
    const deletion = financeApprovalReason('delete-open-item', { accountName: '演示账套', direction: 'payable', row: {
      date: '2026-09-15', auxiliaryItemName: '供应商甲', amount: '80.00', balance: '80.00', summary: '采购款',
    }, fingerprint: 'digest' })
    expect(deletion).toContain('将删除以下应付记录')
    expect(deletion).toContain('可能连带影响关联对冲、核销或收入记录')
    expect(deletion).not.toContain('fingerprint')

    const writeOff = financeApprovalReason('write-off-open-item', { accountName: '演示账套', input: {
      direction: 'receivable', amount: '80.00', currencyCode: 'RMB', date: '2026-09-15', keeperName: '施',
      sourceQuery: { page: 1 },
    }, target: { auxiliaryItemName: '客户甲' }, cash: { cashAccount: { name: '银行存款' } } })
    expect(writeOff).toContain('核销金额：80.00 RMB')
    expect(writeOff).toContain('不会发起银行收付款')
    expect(writeOff).not.toContain('sourceQuery')
  })
})
