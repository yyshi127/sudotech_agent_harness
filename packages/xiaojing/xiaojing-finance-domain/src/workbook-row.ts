/** Exact-text cell encoding shared by Finance workbook serializers. */
import type { Row } from 'write-excel-file/node'

/**
 * Encode literal text without formula interpretation or silent Excel cell truncation.
 * @param values - Display text already selected by the owning report serializer.
 * @returns Explicit string cells; rejects values exceeding Excel's cell capacity.
 */
export function workbookRow(...values: string[]): Row {
  return values.map((value) => {
    if (value.length > 32_767) throw new Error('导出字段超过 Excel 单元格容量，未生成截断文件。')
    return { type: String, value }
  })
}

/**
 * Build explicit readable column widths for a business worksheet.
 * @param widths - Character widths in sheet order.
 * @returns Writer column options.
 */
export function workbookColumns(...widths: number[]): { width: number }[] {
  return widths.map(width => ({ width }))
}
