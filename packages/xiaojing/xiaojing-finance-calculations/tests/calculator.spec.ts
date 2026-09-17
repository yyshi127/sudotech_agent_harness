import { describe, expect, it } from 'vitest'
import { calculateFinanceTrial } from '../src/calculator.ts'

function output(result: ReturnType<typeof calculateFinanceTrial>, name: string): string | undefined {
  return result.outputs.find(value => value.name === name)?.value
}

describe('Xiaojing Finance deterministic trial calculations', () => {
  it('requires a taxpayer type for an unbound VAT consultation', () => {
    const result = calculateFinanceTrial({
      calculation: 'vat',
      asOfDate: '2026-08-29',
      taxExclusiveSales: '1000.00',
      vatRatePercent: '13',
    })

    expect(result.status).toBe('needs-input')
    expect(result.missingInputs).toEqual(['taxpayer_type'])
    expect(result.outputs).toEqual([])
  })

  it('calculates one-rate general-taxpayer VAT with input and prior credits', () => {
    const result = calculateFinanceTrial({
      calculation: 'vat',
      asOfDate: '2026-08-29',
      taxpayerType: 'general-vat',
      taxExclusiveSales: '100000',
      vatRatePercent: '13',
      deductibleInputVat: '5000',
      priorVatCredit: '1000',
    })

    expect(result.status).toBe('complete')
    expect(output(result, 'output_vat')).toBe('13000.00')
    expect(output(result, 'vat_payable')).toBe('7000.00')
    expect(output(result, 'ending_vat_credit')).toBe('0.00')
    expect(result.ruleSetVersion).toBe('cn-mainland-2026-v1')
  })

  it('uses only explicitly non-exempt sales below the small-scale monthly threshold', () => {
    const result = calculateFinanceTrial({
      calculation: 'vat',
      asOfDate: '2026-08-29',
      taxpayerType: 'small-scale-vat',
      taxExclusiveSales: '80000',
      filingFrequency: 'monthly',
      mandatoryTaxableSales: '10000',
      applySmallScaleOnePercent: true,
    })

    expect(result.status).toBe('complete')
    expect(output(result, 'vat_taxable_base')).toBe('10000.00')
    expect(output(result, 'vat_payable')).toBe('100.00')
    expect(result.steps[0]?.result).toContain('门槛内免税条件')
  })

  it('taxes all small-scale sales after the threshold is exceeded', () => {
    const result = calculateFinanceTrial({
      calculation: 'vat',
      asOfDate: '2027-12-31',
      taxpayerType: 'small-scale-vat',
      taxExclusiveSales: '120000',
      filingFrequency: 'monthly',
      applySmallScaleOnePercent: true,
    })

    expect(result.status).toBe('complete')
    expect(output(result, 'vat_taxable_base')).toBe('120000.00')
    expect(output(result, 'vat_payable')).toBe('1200.00')
  })

  it('calculates VAT-derived surcharges with an explicit half reduction', () => {
    const result = calculateFinanceTrial({
      calculation: 'vat-surcharges',
      asOfDate: '2026-08-29',
      paidVat: '10000',
      urbanMaintenanceTaxRatePercent: '7',
      applySixTaxTwoFeeHalfReduction: true,
    })

    expect(result.status).toBe('complete')
    expect(output(result, 'urban_maintenance_tax')).toBe('350.00')
    expect(output(result, 'education_surcharge')).toBe('150.00')
    expect(output(result, 'local_education_surcharge')).toBe('100.00')
    expect(output(result, 'total_vat_surcharges')).toBe('600.00')
  })

  it('distinguishes general and small-low-profit enterprise income tax', () => {
    const small = calculateFinanceTrial({
      calculation: 'enterprise-income-tax',
      asOfDate: '2026-08-29',
      cumulativeTaxableIncome: '1000000',
      priorPrepaidEnterpriseIncomeTax: '20000',
      smallLowProfitEnterprise: true,
      restrictedOrProhibitedIndustry: false,
      employeeCount: 50,
      totalAssets: '10000000',
    })
    const general = calculateFinanceTrial({
      calculation: 'enterprise-income-tax',
      asOfDate: '2026-08-29',
      cumulativeTaxableIncome: '1000000',
      priorPrepaidEnterpriseIncomeTax: '20000',
      smallLowProfitEnterprise: false,
    })

    expect(output(small, 'current_enterprise_income_tax_payable')).toBe('30000.00')
    expect(output(general, 'current_enterprise_income_tax_payable')).toBe('230000.00')
  })

  it('requires an explicit prior prepaid amount for enterprise income tax', () => {
    const result = calculateFinanceTrial({
      calculation: 'enterprise-income-tax',
      asOfDate: '2026-08-29',
      cumulativeTaxableIncome: '1000000',
      smallLowProfitEnterprise: false,
    })
    expect(result.status).toBe('needs-input')
    expect(result.missingInputs).toContain('prior_prepaid_enterprise_income_tax')
    expect(result.outputs).toEqual([])
  })

  it('calculates cumulative resident salary withholding with the statutory table', () => {
    const result = calculateFinanceTrial({
      calculation: 'salary-iit',
      asOfDate: '2026-08-29',
      cumulativeIncome: '120000',
      monthsEmployed: 6,
      cumulativeSpecialDeductions: '10000',
      cumulativeAdditionalDeductions: '12000',
      cumulativeTaxWithheld: '3000',
    })

    expect(result.status).toBe('complete')
    expect(output(result, 'cumulative_taxable_income')).toBe('68000.00')
    expect(output(result, 'cumulative_salary_iit')).toBe('4280.00')
    expect(output(result, 'current_salary_iit_withholding')).toBe('1280.00')
  })

  it('returns missing inputs instead of guessing', () => {
    const result = calculateFinanceTrial({
      calculation: 'vat',
      asOfDate: '2026-08-29',
      taxpayerType: 'general-vat',
    })

    expect(result.status).toBe('needs-input')
    expect(result.missingInputs).toEqual(expect.arrayContaining(['tax_exclusive_sales', 'vat_rate_percent']))
    expect(result.steps).toEqual([])
  })

  it('rejects dates outside the audited rule-pack interval', () => {
    const result = calculateFinanceTrial({
      calculation: 'salary-iit',
      asOfDate: '2028-01-01',
      cumulativeIncome: '10000',
      monthsEmployed: 1,
    })

    expect(result.status).toBe('unsupported')
    expect(result.warnings[0]).toContain('只支持 2026-01-01 至 2027-12-31')
  })

  it('rejects a request taxpayer type that conflicts with the bound client snapshot', () => {
    const result = calculateFinanceTrial({
      calculation: 'vat',
      asOfDate: '2026-08-29',
      taxpayerType: 'small-scale-vat',
      taxExclusiveSales: '100000',
      vatRatePercent: '13',
    }, { taxpayerType: 'general-vat', registeredRegion: '上海市' })

    expect(result.status).toBe('needs-input')
    expect(result.taxpayerTypeSource).toBe('client')
    expect(result.invalidInputs[0]).toContain('冲突')
  })
})
