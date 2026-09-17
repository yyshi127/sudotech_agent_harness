/** XLSX serialization of Host-produced open-item reports; external values are never formulas. */
import writeExcelFile, { type Row } from 'write-excel-file/node'
import type { OpenItemAggregate, OpenItemAnalysisResult } from './open-item-analysis.ts'

import { workbookColumns as widths, workbookRow as row } from './workbook-row.ts'

/**
 * Serialize a completed backend report without recomputing amounts or accepting model-authored rows.
 * @param report - Host-produced, count-reconciled business report.
 * @returns XLSX bytes; money remains exact text, including values beginning with equals.
 */
export async function openItemWorkbook(report: OpenItemAnalysisResult): Promise<Buffer> {
  const groups: Row[] = [row('期间类型', '开始期间', '结束期间', '币种', '分组名称', '金额', '余额')]
  const append = (label: string, aggregate: OpenItemAggregate): void => {
    for (const group of aggregate.groups) {
      groups.push(row(label, aggregate.periodStart, aggregate.periodEnd, group.currencyCode,
        group.dimensionName, group.amount, group.balance))
    }
  }
  append('当前', report.current)
  if (report.baseline) append('基准', report.baseline)
  const differences: Row[] = [row('币种', '分组名称', '出现期间', '金额差额', '余额差额')]
  for (const difference of report.differences ?? []) {
    const name = report.current.groups.find(group => group.dimensionId === difference.dimensionId)?.dimensionName
      ?? report.baseline?.groups.find(group => group.dimensionId === difference.dimensionId)?.dimensionName ?? '未提供'
    differences.push(row(difference.currencyCode, name,
      difference.presence === 'both' ? '两个期间' : difference.presence === 'current-only' ? '仅当前期间' : '仅基准期间',
      difference.amount, difference.balance))
  }
  return writeExcelFile([
    { sheet: '分组结果', data: groups, columns: widths(12, 12, 12, 10, 22, 16, 16), stickyRowsCount: 1 },
    ...(report.baseline ? [{ sheet: '期间差额', data: differences, columns: widths(10, 22, 14, 16, 16), stickyRowsCount: 1 }] : []),
  ]).toBuffer()
}
