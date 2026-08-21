import { describe, expect, it } from 'vitest'
import { formatWeixinText, splitWeixinText } from '../src/formatter.ts'

describe('Weixin reply formatting', () => {
  it('turns a financial Markdown answer into readable mobile text', () => {
    expect(formatWeixinText(`
# 报销审核结果

**结论：** 本次报销可以提交。

| 项目 | 金额 | 状态 |
| --- | ---: | --- |
| 差旅费 | ¥1,280.50 | 已核验 |
| 进项税 | ¥76.83 | 可抵扣 |

## 下一步
1. 核对发票号码
2. 点击 **提交审批**

详情见[公司制度](https://example.com/policy)。
`)).toBe(`【报销审核结果】

结论： 本次报销可以提交。

• 项目：差旅费；金额：¥1,280.50；状态：已核验
• 项目：进项税；金额：¥76.83；状态：可抵扣

【下一步】
1. 核对发票号码
2. 点击 提交审批

详情见公司制度（https://example.com/policy）。`)
  })

  it('labels code and keeps inline technical values legible', () => {
    expect(formatWeixinText('运行 `pnpm test`：\n\n```powershell\npnpm.cmd test\n```'))
      .toBe('运行 「pnpm test」：\n\n—— 代码 ——\npnpm.cmd test\n—— 结束 ——')
  })

  it('splits by paragraphs, preserves emoji code points, and labels each part', () => {
    const parts = splitWeixinText(`${'结果很好🙂'.repeat(45)}\n\n${'下一步'.repeat(70)}`, 220)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(part => Array.from(part).length <= 220)).toBe(true)
    expect(parts[0]).toMatch(/^（1\/\d+）\n/)
    expect(parts.at(-1)).toMatch(/^（\d+\/\d+）\n/)
    expect(parts.join('')).not.toContain('\ud83d\n')
  })

  it('rejects a delivery budget too small for readable messages', () => {
    expect(() => splitWeixinText('test', 199)).toThrow('at least 200')
  })
})
