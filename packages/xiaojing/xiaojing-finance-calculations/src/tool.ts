/** Finance-preset tool for versioned deterministic trial calculations. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { FinanceCalculationRequest, FinanceCalculationResult } from './types.ts'

/** Loader-visible plugin name. */
export const name = 'xiaojing-finance-calculations-tool'

/** Required services for the Finance calculation consumer. */
export const inject = ['tools', 'xiaojingFinanceCalculations']

function renderValues(values: FinanceCalculationResult['inputs']): string[] {
  return values.map(value => `- ${value.label}：${value.value}${value.unit === '文本' || value.unit === '布尔' ? '' : value.unit}（${value.source}）`)
}

/**
 * Render the complete calculation trace for the model-visible transcript.
 * @param result - Structured calculation result.
 * @returns Markdown trial-calculation report.
 */
export function renderFinanceCalculation(result: FinanceCalculationResult): string {
  const status = {
    complete: '已完成',
    'needs-input': '需要补充输入',
    unsupported: '规则版本不支持',
  }[result.status]
  const sections = [
    `## 财税试算：${status}`,
    '',
    `- 试算类型：${result.calculation}`,
    `- 依据日期：${result.asOfDate}`,
    `- 规则版本：${result.ruleSetVersion}`,
    `- 舍入口径：${result.rounding}`,
  ]
  if (result.missingInputs.length > 0) {
    sections.push('', '### 缺少输入', ...result.missingInputs.map(value => `- ${value}`))
  }
  if (result.invalidInputs.length > 0) {
    sections.push('', '### 输入冲突', ...result.invalidInputs.map(value => `- ${value}`))
  }
  if (result.inputs.length > 0) {
    sections.push('', '### 已用输入', ...renderValues(result.inputs))
  }
  if (result.steps.length > 0) {
    sections.push('', '### 计算过程', ...result.steps.map((step, index) => `${index + 1}. ${step.label}：${step.expression} = ${step.result}`))
  }
  if (result.outputs.length > 0) {
    sections.push('', '### 试算结果', ...renderValues(result.outputs))
  }
  if (result.assumptions.length > 0) {
    sections.push('', '### 前提', ...result.assumptions.map(value => `- ${value}`))
  }
  if (result.warnings.length > 0) {
    sections.push('', '### 限制', ...result.warnings.map(value => `- ${value}`))
  }
  sections.push(
    '',
    '### 官方依据',
    ...result.rules.map(rule => `- [${rule.title}](${rule.url})${rule.documentNumber === undefined ? '' : `（${rule.documentNumber}）`}，适用起始 ${rule.effectiveFrom}${rule.effectiveTo === undefined ? '' : `，截至 ${rule.effectiveTo}`}`),
    '',
    `> ${result.disclaimer}`,
  )
  return sections.join('\n')
}

const valueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    label: { type: 'string', required: true },
    value: { type: 'string', required: true },
    unit: { type: 'string', required: true, enum: ['元', '%', '月', '人', '布尔', '文本'] },
    source: { type: 'string', required: true, enum: ['request', 'client', 'rule'] },
  },
} as const

/** Register the Finance-only deterministic calculation tool. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'finance_calculation',
    description: [
      'Run deterministic, versioned Chinese-mainland tax trial calculations without inventing formulas or rates.',
      'Supported calculations are vat, vat-surcharges, enterprise-income-tax, and salary-iit for dates from 2026-01-01 through 2027-12-31.',
      'Use decimal-string yuan amounts. Omitted optional monetary fields mean zero; fields required by the selected calculation are returned as missing instead of guessed.',
      'For VAT, a bound client supplies taxpayer_type; otherwise provide it. General VAT requires tax_exclusive_sales and vat_rate_percent. Small-scale VAT also requires filing_frequency and explicit apply_small_scale_one_percent; mandatory_taxable_sales is the user-confirmed portion that remains taxable inside the threshold.',
      'VAT surcharges require paid_vat, the statutory urban rate, and explicit six-tax-and-two-fee eligibility. Enterprise income tax requires cumulative taxable income, prior prepaid enterprise income tax (including an explicit zero), and explicit small-low-profit status. Salary IIT uses cumulative withholding inputs.',
      'Every result is a trial calculation, not a filing result. Use finance_evidence when the date, locality, eligibility, or special business facts fall outside the embedded rule pack.',
    ].join(' '),
    parameters: {
      calculation: {
        type: 'string',
        required: true,
        enum: ['vat', 'vat-surcharges', 'enterprise-income-tax', 'salary-iit'],
        description: 'Deterministic calculation to run.',
      },
      as_of_date: {
        type: 'string',
        required: true,
        description: 'Rule-evaluation date in YYYY-MM-DD. The first rule pack supports 2026-01-01 through 2027-12-31.',
      },
      taxpayer_type: {
        type: 'string',
        enum: ['general-vat', 'small-scale-vat', 'other'],
        description: 'Required for VAT in an unbound consultation. A bound client supplies and locks this value.',
      },
      tax_exclusive_sales: { type: 'string', description: 'Non-negative tax-exclusive sales in yuan, with at most two decimal places.' },
      vat_rate_percent: { type: 'string', enum: ['13', '9', '6'], description: 'Single VAT rate for the general-taxpayer example.' },
      deductible_input_vat: { type: 'string', description: 'User-established deductible input VAT in yuan; omission means zero.' },
      prior_vat_credit: { type: 'string', description: 'User-established prior-period VAT credit in yuan; omission means zero.' },
      filing_frequency: { type: 'string', enum: ['monthly', 'quarterly'], description: 'Small-scale VAT filing frequency.' },
      mandatory_taxable_sales: { type: 'string', description: 'Small-scale sales that remain taxable even when total sales meet the exemption threshold; omission means zero.' },
      apply_small_scale_one_percent: { type: 'boolean', description: 'Explicitly state whether the temporary 1% small-scale levy rate is eligible.' },
      paid_vat: { type: 'string', description: 'VAT actually paid and included in the additional-tax base.' },
      paid_consumption_tax: { type: 'string', description: 'Consumption tax actually paid and included in the additional-tax base; omission means zero.' },
      urban_maintenance_tax_rate_percent: { type: 'string', enum: ['7', '5', '1'], description: 'Statutory urban maintenance and construction tax tier established by the user.' },
      apply_six_tax_two_fee_half_reduction: { type: 'boolean', description: 'Explicitly state whether the entity is eligible for the 50% six-tax-and-two-fee reduction.' },
      cumulative_taxable_income: { type: 'string', description: 'User-established cumulative enterprise taxable income in yuan.' },
      prior_prepaid_enterprise_income_tax: { type: 'string', description: 'Enterprise income tax already prepaid in yuan. Provide an explicit zero when none was prepaid; omission stops the calculation.' },
      small_low_profit_enterprise: { type: 'boolean', description: 'Explicitly choose whether to apply the small-low-profit enterprise trial treatment.' },
      restricted_or_prohibited_industry: { type: 'boolean', description: 'Required when applying small-low-profit treatment.' },
      employee_count: { type: 'number', description: 'Non-negative employee count, required when applying small-low-profit treatment.' },
      total_assets: { type: 'string', description: 'Total assets in yuan, required when applying small-low-profit treatment.' },
      cumulative_income: { type: 'string', description: 'Cumulative resident salary income in yuan.' },
      cumulative_tax_exempt_income: { type: 'string', description: 'Cumulative tax-exempt salary income in yuan; omission means zero.' },
      months_employed: { type: 'number', description: 'Integer employed months from 1 through 12.' },
      cumulative_special_deductions: { type: 'string', description: 'Cumulative statutory special deductions in yuan; omission means zero.' },
      cumulative_additional_deductions: { type: 'string', description: 'Cumulative special additional deductions in yuan; omission means zero.' },
      cumulative_other_deductions: { type: 'string', description: 'Cumulative other lawful deductions in yuan; omission means zero.' },
      cumulative_tax_relief: { type: 'string', description: 'Cumulative tax relief in yuan; omission means zero.' },
      cumulative_tax_withheld: { type: 'string', description: 'Cumulative salary IIT already withheld in yuan; omission means zero.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['complete', 'needs-input', 'unsupported'] },
          calculation: { type: 'string', required: true, enum: ['vat', 'vat-surcharges', 'enterprise-income-tax', 'salary-iit'] },
          asOfDate: { type: 'string', required: true },
          ruleSetVersion: { type: 'string', required: true },
          taxpayerType: { type: 'string', enum: ['general-vat', 'small-scale-vat', 'other'] },
          taxpayerTypeSource: { type: 'string', required: true, enum: ['request', 'client', 'none'] },
          inputs: { type: 'array', required: true, items: valueSchema },
          steps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', required: true },
                expression: { type: 'string', required: true },
                result: { type: 'string', required: true },
              },
            },
          },
          outputs: { type: 'array', required: true, items: valueSchema },
          missingInputs: { type: 'array', required: true, items: { type: 'string' } },
          invalidInputs: { type: 'array', required: true, items: { type: 'string' } },
          assumptions: { type: 'array', required: true, items: { type: 'string' } },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          rounding: { type: 'string', required: true },
          rules: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                documentNumber: { type: 'string' },
                effectiveFrom: { type: 'string', required: true },
                effectiveTo: { type: 'string' },
                url: { type: 'string', required: true },
              },
            },
          },
          disclaimer: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderFinanceCalculation(value) }],
    },
    isConcurrencySafe: () => true,
    execute(args, exec) {
      if (!exec.agent) throw new Error('finance_calculation requires an owning Finance agent session')
      const request: FinanceCalculationRequest = {
        calculation: args.calculation,
        asOfDate: args.as_of_date,
        ...args.taxpayer_type === undefined ? {} : { taxpayerType: args.taxpayer_type },
        ...args.tax_exclusive_sales === undefined ? {} : { taxExclusiveSales: args.tax_exclusive_sales },
        ...args.vat_rate_percent === undefined ? {} : { vatRatePercent: args.vat_rate_percent },
        ...args.deductible_input_vat === undefined ? {} : { deductibleInputVat: args.deductible_input_vat },
        ...args.prior_vat_credit === undefined ? {} : { priorVatCredit: args.prior_vat_credit },
        ...args.filing_frequency === undefined ? {} : { filingFrequency: args.filing_frequency },
        ...args.mandatory_taxable_sales === undefined ? {} : { mandatoryTaxableSales: args.mandatory_taxable_sales },
        ...args.apply_small_scale_one_percent === undefined ? {} : { applySmallScaleOnePercent: args.apply_small_scale_one_percent },
        ...args.paid_vat === undefined ? {} : { paidVat: args.paid_vat },
        ...args.paid_consumption_tax === undefined ? {} : { paidConsumptionTax: args.paid_consumption_tax },
        ...args.urban_maintenance_tax_rate_percent === undefined
          ? {}
          : { urbanMaintenanceTaxRatePercent: args.urban_maintenance_tax_rate_percent },
        ...args.apply_six_tax_two_fee_half_reduction === undefined
          ? {}
          : { applySixTaxTwoFeeHalfReduction: args.apply_six_tax_two_fee_half_reduction },
        ...args.cumulative_taxable_income === undefined ? {} : { cumulativeTaxableIncome: args.cumulative_taxable_income },
        ...args.prior_prepaid_enterprise_income_tax === undefined
          ? {}
          : { priorPrepaidEnterpriseIncomeTax: args.prior_prepaid_enterprise_income_tax },
        ...args.small_low_profit_enterprise === undefined ? {} : { smallLowProfitEnterprise: args.small_low_profit_enterprise },
        ...args.restricted_or_prohibited_industry === undefined
          ? {}
          : { restrictedOrProhibitedIndustry: args.restricted_or_prohibited_industry },
        ...args.employee_count === undefined ? {} : { employeeCount: args.employee_count },
        ...args.total_assets === undefined ? {} : { totalAssets: args.total_assets },
        ...args.cumulative_income === undefined ? {} : { cumulativeIncome: args.cumulative_income },
        ...args.cumulative_tax_exempt_income === undefined ? {} : { cumulativeTaxExemptIncome: args.cumulative_tax_exempt_income },
        ...args.months_employed === undefined ? {} : { monthsEmployed: args.months_employed },
        ...args.cumulative_special_deductions === undefined ? {} : { cumulativeSpecialDeductions: args.cumulative_special_deductions },
        ...args.cumulative_additional_deductions === undefined
          ? {}
          : { cumulativeAdditionalDeductions: args.cumulative_additional_deductions },
        ...args.cumulative_other_deductions === undefined ? {} : { cumulativeOtherDeductions: args.cumulative_other_deductions },
        ...args.cumulative_tax_relief === undefined ? {} : { cumulativeTaxRelief: args.cumulative_tax_relief },
        ...args.cumulative_tax_withheld === undefined ? {} : { cumulativeTaxWithheld: args.cumulative_tax_withheld },
      }
      return Promise.resolve(ctx.xiaojingFinanceCalculations.calculate(exec.agent, request))
    },
    presentCall: () => ({
      card: 'generic',
      title: '执行财税试算',
      kind: 'other',
    }),
  }))
}
