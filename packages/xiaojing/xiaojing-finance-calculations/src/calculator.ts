/** Pure deterministic calculators for the first Xiaojing Finance rule pack. */

import Decimal from 'decimal.js'
import type { FinanceTaxpayerType } from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import {
  EDUCATION_SURCHARGE_RULE,
  ENTERPRISE_INCOME_TAX_LAW,
  FINANCE_RULE_SET_EFFECTIVE_FROM,
  FINANCE_RULE_SET_EFFECTIVE_TO,
  FINANCE_RULE_SET_VERSION,
  LOCAL_EDUCATION_SURCHARGE_RULE,
  SALARY_IIT_WITHHOLDING_RULE,
  SMALL_BUSINESS_RELIEF,
  SMALL_SCALE_VAT_GUIDANCE,
  SMALL_SCALE_VAT_RELIEF,
  URBAN_MAINTENANCE_TAX_LAW,
  VAT_LAW,
} from './rules.ts'
import type {
  FinanceCalculationClientContext,
  FinanceCalculationKind,
  FinanceCalculationRequest,
  FinanceCalculationResult,
  FinanceCalculationRuleReference,
  FinanceCalculationValue,
} from './types.ts'

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ROUNDING = '人民币金额在每个税费结果处按元保留2位，使用四舍五入（ROUND_HALF_UP）；输入金额最多2位小数。'
const DISCLAIMER = '本结果仅为基于明确输入和内置规则版本的试算，不是纳税申报、扣缴申报、缴款或审计结论；正式办理前应核对完整业务事实与主管税务机关口径。'

interface Issues {
  missing: string[]
  invalid: string[]
}

function assertNever(value: never): never {
  throw new Error(`unreachable Finance calculation: ${String(value)}`)
}

function rulesFor(calculation: FinanceCalculationKind): FinanceCalculationRuleReference[] {
  switch (calculation) {
    case 'vat':
      return [VAT_LAW, SMALL_SCALE_VAT_RELIEF, SMALL_SCALE_VAT_GUIDANCE]
    case 'vat-surcharges':
      return [URBAN_MAINTENANCE_TAX_LAW, EDUCATION_SURCHARGE_RULE, LOCAL_EDUCATION_SURCHARGE_RULE, SMALL_BUSINESS_RELIEF]
    case 'enterprise-income-tax':
      return [ENTERPRISE_INCOME_TAX_LAW, SMALL_BUSINESS_RELIEF]
    case 'salary-iit':
      return [SALARY_IIT_WITHHOLDING_RULE]
    default:
      return assertNever(calculation)
  }
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
}

function baseResult(request: FinanceCalculationRequest): FinanceCalculationResult {
  return {
    status: 'needs-input',
    calculation: request.calculation,
    asOfDate: request.asOfDate,
    ruleSetVersion: FINANCE_RULE_SET_VERSION,
    taxpayerTypeSource: 'none',
    inputs: [],
    steps: [],
    outputs: [],
    missingInputs: [],
    invalidInputs: [],
    assumptions: [],
    warnings: [],
    rounding: ROUNDING,
    rules: rulesFor(request.calculation),
    disclaimer: DISCLAIMER,
  }
}

function monetary(
  value: string | undefined,
  field: string,
  issues: Issues,
  required: boolean,
): Decimal | undefined {
  if (value === undefined || value.trim() === '') {
    if (required) issues.missing.push(field)
    return undefined
  }
  const normalized = value.trim()
  if (!MONEY_PATTERN.test(normalized)) {
    issues.invalid.push(`${field} 必须是0至999999999999999之间、最多2位小数的非负人民币金额`)
    return undefined
  }
  return new Decimal(normalized)
}

function optionalMoney(value: string | undefined, field: string, issues: Issues): Decimal | undefined {
  return value === undefined ? new Decimal(0) : monetary(value, field, issues, false)
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}

function traceValue(
  name: string,
  label: string,
  value: string,
  unit: FinanceCalculationValue['unit'],
  source: FinanceCalculationValue['source'] = 'request',
): FinanceCalculationValue {
  return { name, label, value, unit, source }
}

function resolveTaxpayerType(
  request: FinanceCalculationRequest,
  context: FinanceCalculationClientContext,
  result: FinanceCalculationResult,
): FinanceTaxpayerType | undefined {
  if (context.taxpayerType !== undefined) {
    result.taxpayerType = context.taxpayerType
    result.taxpayerTypeSource = 'client'
    if (request.taxpayerType !== undefined && request.taxpayerType !== context.taxpayerType) {
      result.invalidInputs.push(`taxpayer_type 与当前客户不可变档案中的 ${context.taxpayerType} 冲突`)
    }
    return context.taxpayerType
  }
  if (request.taxpayerType === undefined) {
    result.missingInputs.push('taxpayer_type')
    return undefined
  }
  result.taxpayerType = request.taxpayerType
  result.taxpayerTypeSource = 'request'
  return request.taxpayerType
}

function finishIssues(result: FinanceCalculationResult): boolean {
  if (result.missingInputs.length === 0 && result.invalidInputs.length === 0) return false
  result.status = 'needs-input'
  result.warnings.push('缺少或冲突的输入解决前，不执行试算。')
  return true
}

function validateRuleDate(result: FinanceCalculationResult): boolean {
  if (!validDate(result.asOfDate)) {
    result.status = 'needs-input'
    result.invalidInputs.push('as_of_date 必须是真实存在的 YYYY-MM-DD 日期')
    return false
  }
  if (result.asOfDate < FINANCE_RULE_SET_EFFECTIVE_FROM || result.asOfDate > FINANCE_RULE_SET_EFFECTIVE_TO) {
    result.status = 'unsupported'
    result.warnings.push(
      `规则包 ${FINANCE_RULE_SET_VERSION} 只支持 ${FINANCE_RULE_SET_EFFECTIVE_FROM} 至 ${FINANCE_RULE_SET_EFFECTIVE_TO}；请先用 finance_evidence 核验目标日期规则。`,
    )
    return false
  }
  return true
}

function calculateVat(
  request: FinanceCalculationRequest,
  context: FinanceCalculationClientContext,
  result: FinanceCalculationResult,
): FinanceCalculationResult {
  const issues: Issues = { missing: result.missingInputs, invalid: result.invalidInputs }
  const taxpayerType = resolveTaxpayerType(request, context, result)
  const sales = monetary(request.taxExclusiveSales, 'tax_exclusive_sales', issues, true)
  if (taxpayerType === 'other') {
    result.invalidInputs.push('taxpayer_type=other 不属于首版增值税试算支持范围')
  }
  if (taxpayerType === undefined || taxpayerType === 'other') {
    finishIssues(result)
    return result
  }
  if (taxpayerType === 'general-vat') {
    result.rules = [VAT_LAW]
    if (request.vatRatePercent === undefined) result.missingInputs.push('vat_rate_percent')
    const inputVat = optionalMoney(request.deductibleInputVat, 'deductible_input_vat', issues)
    const priorCredit = optionalMoney(request.priorVatCredit, 'prior_vat_credit', issues)
    if (
      finishIssues(result)
      || sales === undefined
      || inputVat === undefined
      || priorCredit === undefined
      || request.vatRatePercent === undefined
    ) return result
    const rate = new Decimal(request.vatRatePercent).dividedBy(100)
    const outputVat = sales.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    const net = outputVat.minus(inputVat).minus(priorCredit)
    const payable = Decimal.max(net, 0)
    const endingCredit = Decimal.max(net.negated(), 0)
    result.inputs.push(
      traceValue('taxpayer_type', '纳税人类型', '一般纳税人', '文本', result.taxpayerTypeSource === 'client' ? 'client' : 'request'),
      traceValue('tax_exclusive_sales', '不含税销售额', money(sales), '元'),
      traceValue('vat_rate_percent', '增值税税率', request.vatRatePercent, '%'),
      traceValue('deductible_input_vat', '可抵扣进项税额', money(inputVat), '元'),
      traceValue('prior_vat_credit', '上期留抵税额', money(priorCredit), '元'),
    )
    result.steps.push(
      { label: '销项税额', expression: `${money(sales)} × ${request.vatRatePercent}%`, result: money(outputVat) },
      { label: '本期差额', expression: `${money(outputVat)} - ${money(inputVat)} - ${money(priorCredit)}`, result: money(net) },
    )
    result.outputs.push(
      traceValue('output_vat', '销项税额', money(outputVat), '元', 'rule'),
      traceValue('vat_payable', '本期增值税试算应纳额', money(payable), '元', 'rule'),
      traceValue('ending_vat_credit', '期末留抵试算额', money(endingCredit), '元', 'rule'),
    )
    result.assumptions.push('销售额全部适用一个已由用户确认的税率。')
    result.warnings.push('未处理混合税率、简易计税、进项转出、加计抵减、留抵退税、出口退税及其他优惠。')
  } else {
    result.rules = [VAT_LAW, SMALL_SCALE_VAT_RELIEF, SMALL_SCALE_VAT_GUIDANCE]
    if (request.filingFrequency === undefined) result.missingInputs.push('filing_frequency')
    if (request.applySmallScaleOnePercent === undefined) result.missingInputs.push('apply_small_scale_one_percent')
    const mandatorySales = optionalMoney(request.mandatoryTaxableSales, 'mandatory_taxable_sales', issues)
    if (sales !== undefined && mandatorySales !== undefined && mandatorySales.greaterThan(sales)) {
      result.invalidInputs.push('mandatory_taxable_sales 不能超过 tax_exclusive_sales')
    }
    if (
      finishIssues(result)
      || sales === undefined
      || mandatorySales === undefined
      || request.filingFrequency === undefined
      || request.applySmallScaleOnePercent === undefined
    ) return result
    const threshold = request.filingFrequency === 'monthly' ? new Decimal(100_000) : new Decimal(300_000)
    const thresholdMet = sales.lessThanOrEqualTo(threshold)
    const taxableBase = thresholdMet ? mandatorySales : sales
    const ratePercent = request.applySmallScaleOnePercent ? '1' : '3'
    const payable = taxableBase.times(new Decimal(ratePercent).dividedBy(100))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    result.inputs.push(
      traceValue('taxpayer_type', '纳税人类型', '小规模纳税人', '文本', result.taxpayerTypeSource === 'client' ? 'client' : 'request'),
      traceValue('tax_exclusive_sales', '政策口径不含税销售额', money(sales), '元'),
      traceValue('filing_frequency', '申报频次', request.filingFrequency === 'monthly' ? '按月' : '按季', '文本'),
      traceValue('mandatory_taxable_sales', '门槛内仍须计税销售额', money(mandatorySales), '元'),
      traceValue('levy_rate', '试算征收率', ratePercent, '%', 'rule'),
    )
    result.steps.push(
      {
        label: '免税门槛判断',
        expression: `${money(sales)} ${thresholdMet ? '≤' : '>'} ${money(threshold)}`,
        result: thresholdMet ? '达到门槛内免税条件，只有明确不可免部分进入试算' : '超过门槛，全部销售额进入试算',
      },
      { label: '增值税试算', expression: `${money(taxableBase)} × ${ratePercent}%`, result: money(payable) },
    )
    result.outputs.push(
      traceValue('vat_taxable_base', '增值税试算计税销售额', money(taxableBase), '元', 'rule'),
      traceValue('vat_payable', '本期增值税试算应纳额', money(payable), '元', 'rule'),
    )
    result.assumptions.push('tax_exclusive_sales 已按现行政策口径汇总；mandatory_taxable_sales 由用户依据专票、放弃免税等事实确认。')
    result.warnings.push('未处理差额征税、不动产销售、跨期红冲、专票缴回、预缴项目及其他特殊征管情形。')
  }
  result.status = 'complete'
  return result
}

function calculateVatSurcharges(
  request: FinanceCalculationRequest,
  context: FinanceCalculationClientContext,
  result: FinanceCalculationResult,
): FinanceCalculationResult {
  const issues: Issues = { missing: result.missingInputs, invalid: result.invalidInputs }
  const paidVat = monetary(request.paidVat, 'paid_vat', issues, true)
  const paidConsumptionTax = optionalMoney(request.paidConsumptionTax, 'paid_consumption_tax', issues)
  if (request.urbanMaintenanceTaxRatePercent === undefined) result.missingInputs.push('urban_maintenance_tax_rate_percent')
  if (request.applySixTaxTwoFeeHalfReduction === undefined) result.missingInputs.push('apply_six_tax_two_fee_half_reduction')
  if (
    finishIssues(result)
    || paidVat === undefined
    || paidConsumptionTax === undefined
    || request.urbanMaintenanceTaxRatePercent === undefined
    || request.applySixTaxTwoFeeHalfReduction === undefined
  ) return result
  const base = paidVat.plus(paidConsumptionTax)
  const reduction = request.applySixTaxTwoFeeHalfReduction ? new Decimal('0.5') : new Decimal(1)
  const urbanRate = new Decimal(request.urbanMaintenanceTaxRatePercent).dividedBy(100)
  const urbanTax = base.times(urbanRate).times(reduction).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const education = base.times('0.03').times(reduction).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const localEducation = base.times('0.02').times(reduction).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const total = urbanTax.plus(education).plus(localEducation)
  result.inputs.push(
    traceValue('paid_vat', '实际缴纳增值税', money(paidVat), '元'),
    traceValue('paid_consumption_tax', '实际缴纳消费税', money(paidConsumptionTax), '元'),
    traceValue('urban_maintenance_tax_rate_percent', '城市维护建设税税率', request.urbanMaintenanceTaxRatePercent, '%'),
    traceValue('six_tax_two_fee_reduction', '六税两费减半', request.applySixTaxTwoFeeHalfReduction ? '是' : '否', '布尔'),
  )
  result.steps.push(
    { label: '附加税费计税依据', expression: `${money(paidVat)} + ${money(paidConsumptionTax)}`, result: money(base) },
    { label: '城市维护建设税', expression: `${money(base)} × ${request.urbanMaintenanceTaxRatePercent}% × ${reduction.toString()}`, result: money(urbanTax) },
    { label: '教育费附加', expression: `${money(base)} × 3% × ${reduction.toString()}`, result: money(education) },
    { label: '地方教育附加', expression: `${money(base)} × 2% × ${reduction.toString()}`, result: money(localEducation) },
  )
  result.outputs.push(
    traceValue('urban_maintenance_tax', '城市维护建设税试算额', money(urbanTax), '元', 'rule'),
    traceValue('education_surcharge', '教育费附加试算额', money(education), '元', 'rule'),
    traceValue('local_education_surcharge', '地方教育附加试算额', money(localEducation), '元', 'rule'),
    traceValue('total_vat_surcharges', '附加税费试算合计', money(total), '元', 'rule'),
  )
  if (context.registeredRegion !== undefined) {
    result.assumptions.push(`客户注册地区为“${context.registeredRegion}”，但城建税档位仍由用户明确选择，系统未从地址文字自动推断。`)
  }
  result.assumptions.push('是否符合六税两费减半条件由用户依据完整主体和期间事实确认。')
  result.warnings.push('未处理月销售额免征教育费附加、进口环节、留抵退税扣减及地方特殊政策。')
  result.status = 'complete'
  return result
}

function calculateEnterpriseIncomeTax(
  request: FinanceCalculationRequest,
  result: FinanceCalculationResult,
): FinanceCalculationResult {
  const issues: Issues = { missing: result.missingInputs, invalid: result.invalidInputs }
  const taxableIncome = monetary(request.cumulativeTaxableIncome, 'cumulative_taxable_income', issues, true)
  const prepaid = monetary(request.priorPrepaidEnterpriseIncomeTax, 'prior_prepaid_enterprise_income_tax', issues, true)
  if (request.smallLowProfitEnterprise === undefined) result.missingInputs.push('small_low_profit_enterprise')
  let assets: Decimal | undefined
  if (request.smallLowProfitEnterprise === true) {
    if (request.restrictedOrProhibitedIndustry === undefined) result.missingInputs.push('restricted_or_prohibited_industry')
    if (request.employeeCount === undefined) result.missingInputs.push('employee_count')
    assets = monetary(request.totalAssets, 'total_assets', issues, true)
    if (request.employeeCount !== undefined && (!Number.isSafeInteger(request.employeeCount) || request.employeeCount < 0)) {
      result.invalidInputs.push('employee_count 必须是非负安全整数')
    }
    if (request.restrictedOrProhibitedIndustry === true) result.invalidInputs.push('受限制或禁止行业不能按本规则包使用小型微利企业优惠')
    if (request.employeeCount !== undefined && request.employeeCount > 300) result.invalidInputs.push('employee_count 超过小型微利企业300人条件')
    if (assets !== undefined && assets.greaterThan(50_000_000)) result.invalidInputs.push('total_assets 超过小型微利企业5000万元条件')
    if (taxableIncome !== undefined && taxableIncome.greaterThan(3_000_000)) result.invalidInputs.push('cumulative_taxable_income 超过小型微利企业300万元条件')
  }
  if (
    finishIssues(result)
    || taxableIncome === undefined
    || prepaid === undefined
    || request.smallLowProfitEnterprise === undefined
  ) return result
  const small = request.smallLowProfitEnterprise
  const cumulativeTax = small
    ? taxableIncome.times('0.25').times('0.20').toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : taxableIncome.times('0.25').toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const currentPayable = Decimal.max(cumulativeTax.minus(prepaid), 0)
  result.inputs.push(
    traceValue('cumulative_taxable_income', '累计应纳税所得额', money(taxableIncome), '元'),
    traceValue('prior_prepaid_enterprise_income_tax', '前期已预缴企业所得税', money(prepaid), '元'),
    traceValue('small_low_profit_enterprise', '按小型微利企业试算', small ? '是' : '否', '布尔'),
  )
  if (small && assets !== undefined && request.employeeCount !== undefined && request.restrictedOrProhibitedIndustry !== undefined) {
    result.inputs.push(
      traceValue('restricted_or_prohibited_industry', '限制或禁止行业', request.restrictedOrProhibitedIndustry ? '是' : '否', '布尔'),
      traceValue('employee_count', '从业人数', String(request.employeeCount), '人'),
      traceValue('total_assets', '资产总额', money(assets), '元'),
    )
  }
  result.steps.push({
    label: '累计企业所得税',
    expression: small
      ? `${money(taxableIncome)} × 25% × 20%`
      : `${money(taxableIncome)} × 25%`,
    result: money(cumulativeTax),
  }, {
    label: '本期试算应补税额',
    expression: `max(${money(cumulativeTax)} - ${money(prepaid)}, 0)`,
    result: money(currentPayable),
  })
  result.outputs.push(
    traceValue('cumulative_enterprise_income_tax', '累计企业所得税试算额', money(cumulativeTax), '元', 'rule'),
    traceValue('current_enterprise_income_tax_payable', '本期企业所得税试算应补额', money(currentPayable), '元', 'rule'),
  )
  result.assumptions.push('cumulative_taxable_income 是用户已按税法口径确认的累计应纳税所得额，不由本工具从会计利润推导。')
  result.warnings.push('未处理研发加计扣除、亏损弥补、境外抵免、区域优惠、高新技术企业及其他专项优惠。')
  result.status = 'complete'
  return result
}

interface IitBracket {
  upper?: Decimal
  rate: Decimal
  quickDeduction: Decimal
}

const IIT_TOP_BRACKET: IitBracket = {
  rate: new Decimal('0.45'),
  quickDeduction: new Decimal(181_920),
}

const IIT_BRACKETS: readonly IitBracket[] = [
  { upper: new Decimal(36_000), rate: new Decimal('0.03'), quickDeduction: new Decimal(0) },
  { upper: new Decimal(144_000), rate: new Decimal('0.10'), quickDeduction: new Decimal(2_520) },
  { upper: new Decimal(300_000), rate: new Decimal('0.20'), quickDeduction: new Decimal(16_920) },
  { upper: new Decimal(420_000), rate: new Decimal('0.25'), quickDeduction: new Decimal(31_920) },
  { upper: new Decimal(660_000), rate: new Decimal('0.30'), quickDeduction: new Decimal(52_920) },
  { upper: new Decimal(960_000), rate: new Decimal('0.35'), quickDeduction: new Decimal(85_920) },
  IIT_TOP_BRACKET,
]

function iitBracket(taxableIncome: Decimal): IitBracket {
  return IIT_BRACKETS.find(bracket => bracket.upper === undefined || taxableIncome.lessThanOrEqualTo(bracket.upper))
    ?? IIT_TOP_BRACKET
}

function calculateSalaryIit(request: FinanceCalculationRequest, result: FinanceCalculationResult): FinanceCalculationResult {
  const issues: Issues = { missing: result.missingInputs, invalid: result.invalidInputs }
  const income = monetary(request.cumulativeIncome, 'cumulative_income', issues, true)
  const exemptIncome = optionalMoney(request.cumulativeTaxExemptIncome, 'cumulative_tax_exempt_income', issues)
  const special = optionalMoney(request.cumulativeSpecialDeductions, 'cumulative_special_deductions', issues)
  const additional = optionalMoney(request.cumulativeAdditionalDeductions, 'cumulative_additional_deductions', issues)
  const other = optionalMoney(request.cumulativeOtherDeductions, 'cumulative_other_deductions', issues)
  const relief = optionalMoney(request.cumulativeTaxRelief, 'cumulative_tax_relief', issues)
  const withheld = optionalMoney(request.cumulativeTaxWithheld, 'cumulative_tax_withheld', issues)
  if (request.monthsEmployed === undefined) result.missingInputs.push('months_employed')
  if (
    request.monthsEmployed !== undefined
    && (!Number.isSafeInteger(request.monthsEmployed)
      || request.monthsEmployed < 1
      || request.monthsEmployed > 12)
  ) {
    result.invalidInputs.push('months_employed 必须是1至12的整数')
  }
  if (
    finishIssues(result)
    || income === undefined
    || exemptIncome === undefined
    || special === undefined
    || additional === undefined
    || other === undefined
    || relief === undefined
    || withheld === undefined
    || request.monthsEmployed === undefined
  ) return result
  const basicDeduction = new Decimal(5_000).times(request.monthsEmployed)
  const taxableIncome = Decimal.max(
    income.minus(exemptIncome).minus(basicDeduction).minus(special).minus(additional).minus(other),
    0,
  )
  const bracket = iitBracket(taxableIncome)
  const cumulativeTax = Decimal.max(
    taxableIncome.times(bracket.rate).minus(bracket.quickDeduction).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    0,
  )
  const currentWithholding = Decimal.max(cumulativeTax.minus(relief).minus(withheld), 0)
  result.inputs.push(
    traceValue('cumulative_income', '累计工资薪金收入', money(income), '元'),
    traceValue('cumulative_tax_exempt_income', '累计免税收入', money(exemptIncome), '元'),
    traceValue('months_employed', '累计任职受雇月份', String(request.monthsEmployed), '月'),
    traceValue('basic_deduction', '累计减除费用', money(basicDeduction), '元', 'rule'),
    traceValue('cumulative_special_deductions', '累计专项扣除', money(special), '元'),
    traceValue('cumulative_additional_deductions', '累计专项附加扣除', money(additional), '元'),
    traceValue('cumulative_other_deductions', '累计其他依法确定扣除', money(other), '元'),
    traceValue('cumulative_tax_relief', '累计减免税额', money(relief), '元'),
    traceValue('cumulative_tax_withheld', '累计已预扣预缴税额', money(withheld), '元'),
  )
  const ratePercent = bracket.rate.times(100).toString()
  result.steps.push(
    {
      label: '累计预扣预缴应纳税所得额',
      expression: `${money(income)} - ${money(exemptIncome)} - ${money(basicDeduction)} - ${money(special)} - ${money(additional)} - ${money(other)}`,
      result: money(taxableIncome),
    },
    {
      label: '累计应预扣预缴税额',
      expression: `${money(taxableIncome)} × ${ratePercent}% - ${money(bracket.quickDeduction)}`,
      result: money(cumulativeTax),
    },
    {
      label: '本期应预扣预缴税额',
      expression: `max(${money(cumulativeTax)} - ${money(relief)} - ${money(withheld)}, 0)`,
      result: money(currentWithholding),
    },
  )
  result.outputs.push(
    traceValue('cumulative_taxable_income', '累计预扣预缴应纳税所得额', money(taxableIncome), '元', 'rule'),
    traceValue('cumulative_salary_iit', '累计工资薪金个税试算额', money(cumulativeTax), '元', 'rule'),
    traceValue('current_salary_iit_withholding', '本期工资薪金个税试算应扣额', money(currentWithholding), '元', 'rule'),
  )
  result.assumptions.push('仅适用于居民个人工资薪金累计预扣法；各项累计扣除金额由用户依法确认。')
  result.warnings.push('本期计算为负时按预扣规则暂不退税；年度汇算、多处所得、全年一次性奖金和非居民个人不在本试算范围。')
  result.status = 'complete'
  return result
}

/**
 * Run one deterministic trial calculation without model reasoning.
 * @param request - Explicit calculation request.
 * @param context - Immutable client assumptions, when bound.
 * @returns Auditable result or precise input diagnostics.
 */
export function calculateFinanceTrial(
  request: FinanceCalculationRequest,
  context: FinanceCalculationClientContext = {},
): FinanceCalculationResult {
  const result = baseResult(request)
  if (!validateRuleDate(result)) return result
  switch (request.calculation) {
    case 'vat':
      return calculateVat(request, context, result)
    case 'vat-surcharges':
      return calculateVatSurcharges(request, context, result)
    case 'enterprise-income-tax':
      return calculateEnterpriseIncomeTax(request, result)
    case 'salary-iit':
      return calculateSalaryIit(request, result)
    default:
      return assertNever(request.calculation)
  }
}
