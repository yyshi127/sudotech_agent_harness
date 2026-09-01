import { describe, expect, it } from 'vitest'
import { calculateFinanceTrial } from '../src/calculator.ts'
import { renderFinanceCalculation } from '../src/tool.ts'

describe('Finance calculation transcript rendering', () => {
  it('renders inputs, trace, rules, limitations, and the trial disclaimer', () => {
    const rendered = renderFinanceCalculation(calculateFinanceTrial({
      calculation: 'vat-surcharges',
      asOfDate: '2026-08-29',
      paidVat: '10000',
      urbanMaintenanceTaxRatePercent: '7',
      applySixTaxTwoFeeHalfReduction: true,
    }))

    expect(rendered).toContain('财税试算：已完成')
    expect(rendered).toContain('附加税费试算合计：600.00元')
    expect(rendered).toContain('10000.00 × 7% × 0.5 = 350.00')
    expect(rendered).toContain('[中华人民共和国城市维护建设税法]')
    expect(rendered).toContain('不是纳税申报')
  })

  it('renders precise missing-input diagnostics without a result', () => {
    const rendered = renderFinanceCalculation(calculateFinanceTrial({
      calculation: 'salary-iit',
      asOfDate: '2026-08-29',
    }))

    expect(rendered).toContain('财税试算：需要补充输入')
    expect(rendered).toContain('cumulative_income')
    expect(rendered).toContain('months_employed')
    expect(rendered).not.toContain('### 试算结果')
  })
})
