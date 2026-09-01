/** Public types for versioned Xiaojing Finance trial calculations. */

import type { FinanceTaxpayerType } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'

/** Calculations supported by the first mainland-China rule pack. */
export type FinanceCalculationKind =
  | 'vat'
  | 'vat-surcharges'
  | 'enterprise-income-tax'
  | 'salary-iit'

/** Filing frequency used by the small-scale VAT threshold example. */
export type FinanceFilingFrequency = 'monthly' | 'quarterly'

/** Explicit inputs accepted by the deterministic calculator. */
export interface FinanceCalculationRequest {
  /** Calculation to perform. */
  calculation: FinanceCalculationKind
  /** Rule-evaluation date in `YYYY-MM-DD`. */
  asOfDate: string
  /** Taxpayer type for an unbound consultation; a bound client supplies it. */
  taxpayerType?: FinanceTaxpayerType
  /** Tax-exclusive sales amount in yuan. */
  taxExclusiveSales?: string
  /** VAT rate for a single-rate general-taxpayer example. */
  vatRatePercent?: '13' | '9' | '6'
  /** Deductible input VAT already established by the user. */
  deductibleInputVat?: string
  /** Prior-period VAT credit already established by the user. */
  priorVatCredit?: string
  /** Monthly or quarterly filing for the small-scale threshold example. */
  filingFrequency?: FinanceFilingFrequency
  /** Sales that remain taxable even when the small-scale threshold is met. */
  mandatoryTaxableSales?: string
  /** Whether the user has established eligibility for the temporary 1% levy rate. */
  applySmallScaleOnePercent?: boolean
  /** VAT actually paid and used as an additional-tax base. */
  paidVat?: string
  /** Consumption tax actually paid and used as an additional-tax base. */
  paidConsumptionTax?: string
  /** Urban maintenance and construction tax rate selected from the statutory tiers. */
  urbanMaintenanceTaxRatePercent?: '7' | '5' | '1'
  /** Whether the user has established eligibility for the 50% six-tax-and-two-fee reduction. */
  applySixTaxTwoFeeHalfReduction?: boolean
  /** Cumulative taxable income used by the enterprise-income-tax pre-calculation. */
  cumulativeTaxableIncome?: string
  /** Enterprise income tax prepaid before the current calculation. */
  priorPrepaidEnterpriseIncomeTax?: string
  /** Whether the entity is expected to use the small-low-profit enterprise treatment. */
  smallLowProfitEnterprise?: boolean
  /** Whether the entity conducts a restricted or prohibited industry. */
  restrictedOrProhibitedIndustry?: boolean
  /** Employee count used to check the stated small-low-profit assumptions. */
  employeeCount?: number
  /** Total assets in yuan used to check the stated small-low-profit assumptions. */
  totalAssets?: string
  /** Cumulative salary income in yuan. */
  cumulativeIncome?: string
  /** Cumulative tax-exempt salary income in yuan. */
  cumulativeTaxExemptIncome?: string
  /** Number of employed months represented by the cumulative salary values. */
  monthsEmployed?: number
  /** Cumulative statutory special deductions in yuan. */
  cumulativeSpecialDeductions?: string
  /** Cumulative special additional deductions in yuan. */
  cumulativeAdditionalDeductions?: string
  /** Cumulative other lawful deductions in yuan. */
  cumulativeOtherDeductions?: string
  /** Cumulative tax relief in yuan. */
  cumulativeTaxRelief?: string
  /** Cumulative salary IIT already withheld in yuan. */
  cumulativeTaxWithheld?: string
}

/** Non-sensitive client assumptions available to the calculator. */
export interface FinanceCalculationClientContext {
  /** Taxpayer type copied from an immutable client binding. */
  taxpayerType?: FinanceTaxpayerType
  /** Registered region copied from an immutable client binding. */
  registeredRegion?: string
}

/** One normalized input included in the calculation trace. */
export interface FinanceCalculationValue {
  /** Stable field name. */
  name: string
  /** Chinese display label. */
  label: string
  /** Exact normalized value. */
  value: string
  /** Display unit. */
  unit: '元' | '%' | '月' | '人' | '布尔' | '文本'
  /** Whether the value came from the request, client binding, or rule pack. */
  source: 'request' | 'client' | 'rule'
}

/** One deterministic calculation step. */
export interface FinanceCalculationStep {
  /** Step label. */
  label: string
  /** Human-readable formula with substituted normalized values. */
  expression: string
  /** Step result. */
  result: string
}

/** One official rule reference embedded in the versioned rule pack. */
export interface FinanceCalculationRuleReference {
  /** Stable rule identifier. */
  id: string
  /** Official title. */
  title: string
  /** Official document number when available. */
  documentNumber?: string
  /** First date used by this rule pack. */
  effectiveFrom: string
  /** Last date used by this rule pack when the rule is time-limited. */
  effectiveTo?: string
  /** Direct official source URL. */
  url: string
}

/** Auditable result persisted as an ordinary tool result. */
export interface FinanceCalculationResult {
  /** Whether a complete calculation was produced. */
  status: 'complete' | 'needs-input' | 'unsupported'
  /** Requested calculation. */
  calculation: FinanceCalculationKind
  /** Date used to select rules. */
  asOfDate: string
  /** Immutable rule-pack version. */
  ruleSetVersion: string
  /** Taxpayer type used, when relevant. */
  taxpayerType?: FinanceTaxpayerType
  /** Origin of the taxpayer type. */
  taxpayerTypeSource: 'request' | 'client' | 'none'
  /** Normalized inputs used by the completed calculation. */
  inputs: FinanceCalculationValue[]
  /** Deterministic calculation trace. */
  steps: FinanceCalculationStep[]
  /** Named calculation outputs. */
  outputs: FinanceCalculationValue[]
  /** Required fields that were omitted. */
  missingInputs: string[]
  /** Provided fields that cannot be used safely. */
  invalidInputs: string[]
  /** Explicit assumptions applied by the rule pack. */
  assumptions: string[]
  /** Scope and applicability warnings. */
  warnings: string[]
  /** Rounding policy used by every monetary output. */
  rounding: string
  /** Official references fixed into this rule-pack version. */
  rules: FinanceCalculationRuleReference[]
  /** Mandatory statement preventing filing-result misrepresentation. */
  disclaimer: string
}
