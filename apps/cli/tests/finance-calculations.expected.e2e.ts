import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/finance-documents/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

describe('Xiaojing Finance calculation assembled snapshot', () => {
  it('uses the bound client and renders an auditable VAT trial calculation', async () => {
    const result = await runLoaderSmoke({
      label: 'Xiaojing Finance calculation snapshot',
      tempDirPrefix: 'xiaojing-finance-calculation-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: ['--calculation'],
      tsconfigPath,
      env: { DSH_CLIENT_BUILD_PROFILE: 'xiaojing' },
      processTimeoutMs: LOADER_SMOKE_TEST_TIMEOUT_MS * 2,
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "result": [
          {
            "text": "## 财税试算：已完成

      - 试算类型：vat
      - 依据日期：2026-08-29
      - 规则版本：cn-mainland-2026-v1
      - 舍入口径：人民币金额在每个税费结果处按元保留2位，使用四舍五入（ROUND_HALF_UP）；输入金额最多2位小数。

      ### 已用输入
      - 纳税人类型：一般纳税人（client）
      - 不含税销售额：100000.00元（request）
      - 增值税税率：13%（request）
      - 可抵扣进项税额：5000.00元（request）
      - 上期留抵税额：1000.00元（request）

      ### 计算过程
      1. 销项税额：100000.00 × 13% = 13000.00
      2. 本期差额：13000.00 - 5000.00 - 1000.00 = 7000.00

      ### 试算结果
      - 销项税额：13000.00元（rule）
      - 本期增值税试算应纳额：7000.00元（rule）
      - 期末留抵试算额：0.00元（rule）

      ### 前提
      - 销售额全部适用一个已由用户确认的税率。

      ### 限制
      - 未处理混合税率、简易计税、进项转出、加计抵减、留抵退税、出口退税及其他优惠。

      ### 官方依据
      - [中华人民共和国增值税法](https://www.npc.gov.cn/npc/c2/c30834/202412/t20241225_442038.html)（中华人民共和国主席令第四十一号），适用起始 2026-01-01

      > 本结果仅为基于明确输入和内置规则版本的试算，不是纳税申报、扣缴申报、缴款或审计结论；正式办理前应核对完整业务事实与主管税务机关口径。",
            "type": "text",
          },
        ],
        "tool": {
          "description": "Run deterministic, versioned Chinese-mainland tax trial calculations without inventing formulas or rates. Supported calculations are vat, vat-surcharges, enterprise-income-tax, and salary-iit for dates from 2026-01-01 through 2027-12-31. Use decimal-string yuan amounts. Omitted optional monetary fields mean zero; fields required by the selected calculation are returned as missing instead of guessed. For VAT, a bound client supplies taxpayer_type; otherwise provide it. General VAT requires tax_exclusive_sales and vat_rate_percent. Small-scale VAT also requires filing_frequency and explicit apply_small_scale_one_percent; mandatory_taxable_sales is the user-confirmed portion that remains taxable inside the threshold. VAT surcharges require paid_vat, the statutory urban rate, and explicit six-tax-and-two-fee eligibility. Enterprise income tax requires cumulative taxable income, prior prepaid enterprise income tax (including an explicit zero), and explicit small-low-profit status. Salary IIT uses cumulative withholding inputs. Every result is a trial calculation, not a filing result. Use finance_evidence when the date, locality, eligibility, or special business facts fall outside the embedded rule pack.",
          "name": "finance_calculation",
          "parameters": {
            "properties": {
              "apply_six_tax_two_fee_half_reduction": {
                "description": "Explicitly state whether the entity is eligible for the 50% six-tax-and-two-fee reduction.",
                "type": "boolean",
              },
              "apply_small_scale_one_percent": {
                "description": "Explicitly state whether the temporary 1% small-scale levy rate is eligible.",
                "type": "boolean",
              },
              "as_of_date": {
                "description": "Rule-evaluation date in YYYY-MM-DD. The first rule pack supports 2026-01-01 through 2027-12-31.",
                "type": "string",
              },
              "calculation": {
                "description": "Deterministic calculation to run.",
                "enum": [
                  "vat",
                  "vat-surcharges",
                  "enterprise-income-tax",
                  "salary-iit",
                ],
                "type": "string",
              },
              "cumulative_additional_deductions": {
                "description": "Cumulative special additional deductions in yuan; omission means zero.",
                "type": "string",
              },
              "cumulative_income": {
                "description": "Cumulative resident salary income in yuan.",
                "type": "string",
              },
              "cumulative_other_deductions": {
                "description": "Cumulative other lawful deductions in yuan; omission means zero.",
                "type": "string",
              },
              "cumulative_special_deductions": {
                "description": "Cumulative statutory special deductions in yuan; omission means zero.",
                "type": "string",
              },
              "cumulative_tax_exempt_income": {
                "description": "Cumulative tax-exempt salary income in yuan; omission means zero.",
                "type": "string",
              },
              "cumulative_tax_relief": {
                "description": "Cumulative tax relief in yuan; omission means zero.",
                "type": "string",
              },
              "cumulative_tax_withheld": {
                "description": "Cumulative salary IIT already withheld in yuan; omission means zero.",
                "type": "string",
              },
              "cumulative_taxable_income": {
                "description": "User-established cumulative enterprise taxable income in yuan.",
                "type": "string",
              },
              "deductible_input_vat": {
                "description": "User-established deductible input VAT in yuan; omission means zero.",
                "type": "string",
              },
              "employee_count": {
                "description": "Non-negative employee count, required when applying small-low-profit treatment.",
                "type": "number",
              },
              "filing_frequency": {
                "description": "Small-scale VAT filing frequency.",
                "enum": [
                  "monthly",
                  "quarterly",
                ],
                "type": "string",
              },
              "mandatory_taxable_sales": {
                "description": "Small-scale sales that remain taxable even when total sales meet the exemption threshold; omission means zero.",
                "type": "string",
              },
              "months_employed": {
                "description": "Integer employed months from 1 through 12.",
                "type": "number",
              },
              "paid_consumption_tax": {
                "description": "Consumption tax actually paid and included in the additional-tax base; omission means zero.",
                "type": "string",
              },
              "paid_vat": {
                "description": "VAT actually paid and included in the additional-tax base.",
                "type": "string",
              },
              "prior_prepaid_enterprise_income_tax": {
                "description": "Enterprise income tax already prepaid in yuan. Provide an explicit zero when none was prepaid; omission stops the calculation.",
                "type": "string",
              },
              "prior_vat_credit": {
                "description": "User-established prior-period VAT credit in yuan; omission means zero.",
                "type": "string",
              },
              "restricted_or_prohibited_industry": {
                "description": "Required when applying small-low-profit treatment.",
                "type": "boolean",
              },
              "small_low_profit_enterprise": {
                "description": "Explicitly choose whether to apply the small-low-profit enterprise trial treatment.",
                "type": "boolean",
              },
              "tax_exclusive_sales": {
                "description": "Non-negative tax-exclusive sales in yuan, with at most two decimal places.",
                "type": "string",
              },
              "taxpayer_type": {
                "description": "Required for VAT in an unbound consultation. A bound client supplies and locks this value.",
                "enum": [
                  "general-vat",
                  "small-scale-vat",
                  "other",
                ],
                "type": "string",
              },
              "total_assets": {
                "description": "Total assets in yuan, required when applying small-low-profit treatment.",
                "type": "string",
              },
              "urban_maintenance_tax_rate_percent": {
                "description": "Statutory urban maintenance and construction tax tier established by the user.",
                "enum": [
                  "7",
                  "5",
                  "1",
                ],
                "type": "string",
              },
              "vat_rate_percent": {
                "description": "Single VAT rate for the general-taxpayer example.",
                "enum": [
                  "13",
                  "9",
                  "6",
                ],
                "type": "string",
              },
            },
            "required": [
              "calculation",
              "as_of_date",
            ],
            "type": "object",
          },
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)
})
