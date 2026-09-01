/** Versioned mainland-China rule references used by Finance trial calculations. */

import type { FinanceCalculationRuleReference } from './types.ts'

/** Immutable identifier for the first Finance calculation rule pack. */
export const FINANCE_RULE_SET_VERSION = 'cn-mainland-2026-v1'
/** First date supported by the rule pack. */
export const FINANCE_RULE_SET_EFFECTIVE_FROM = '2026-01-01'
/** Last date supported by time-limited preferences in the rule pack. */
export const FINANCE_RULE_SET_EFFECTIVE_TO = '2027-12-31'

/** VAT law effective for every VAT example in this pack. */
export const VAT_LAW: FinanceCalculationRuleReference = {
  id: 'cn-vat-law-2024',
  title: '中华人民共和国增值税法',
  documentNumber: '中华人民共和国主席令第四十一号',
  effectiveFrom: '2026-01-01',
  url: 'https://www.npc.gov.cn/npc/c2/c30834/202412/t20241225_442038.html',
}

/** Temporary small-scale VAT relief used through 2027. */
export const SMALL_SCALE_VAT_RELIEF: FinanceCalculationRuleReference = {
  id: 'cn-vat-small-scale-2023-19',
  title: '关于增值税小规模纳税人减免增值税政策的公告',
  documentNumber: '财政部 税务总局公告2023年第19号',
  effectiveFrom: '2023-01-01',
  effectiveTo: '2027-12-31',
  url: 'https://tianjin.chinatax.gov.cn/11244000000/8000/800001/80000102/p20230808165940267.shtml',
}

/** Official filing guidance supporting the quarterly threshold used by the example. */
export const SMALL_SCALE_VAT_GUIDANCE: FinanceCalculationRuleReference = {
  id: 'cn-vat-small-scale-filing-guidance',
  title: '按月申报的小规模纳税人如何享受减免增值税政策',
  effectiveFrom: '2023-01-01',
  effectiveTo: '2027-12-31',
  url: 'https://www.chinatax.gov.cn/chinatax/n810356/n3010387/c5237587/content.html',
}

/** Urban maintenance and construction tax basis and rate tiers. */
export const URBAN_MAINTENANCE_TAX_LAW: FinanceCalculationRuleReference = {
  id: 'cn-urban-maintenance-tax-law-2020',
  title: '中华人民共和国城市维护建设税法',
  effectiveFrom: '2021-09-01',
  url: 'https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202008/t20200812_3566258.htm',
}

/** National education surcharge basis and 3% rate. */
export const EDUCATION_SURCHARGE_RULE: FinanceCalculationRuleReference = {
  id: 'cn-education-surcharge-regulation',
  title: '征收教育费附加的暂行规定',
  documentNumber: '国务院令第448号修订',
  effectiveFrom: '2005-10-01',
  url: 'https://xzfg.moj.gov.cn/front/law/detail?LawID=102',
}

/** National policy describing the unified 2% local education surcharge. */
export const LOCAL_EDUCATION_SURCHARGE_RULE: FinanceCalculationRuleReference = {
  id: 'cn-local-education-surcharge-2010',
  title: '财政教育投入将作为中央转移支付重要依据',
  effectiveFrom: '2010-12-01',
  url: 'https://www.mof.gov.cn/zhengwuxinxi/caijingshidian/zgcjb/201107/t20110705_570771.htm',
}

/** Six-tax-and-two-fee relief and small-low-profit EIT policy through 2027. */
export const SMALL_BUSINESS_RELIEF: FinanceCalculationRuleReference = {
  id: 'cn-small-business-relief-2023-12',
  title: '关于进一步支持小微企业和个体工商户发展有关税费政策的公告',
  documentNumber: '财政部 税务总局公告2023年第12号',
  effectiveFrom: '2023-01-01',
  effectiveTo: '2027-12-31',
  url: 'https://fgk.chinatax.gov.cn/zcfgk/c102416/c5210453/content.html',
}

/** Basic 25% enterprise income tax rate. */
export const ENTERPRISE_INCOME_TAX_LAW: FinanceCalculationRuleReference = {
  id: 'cn-enterprise-income-tax-law',
  title: '中华人民共和国企业所得税法',
  effectiveFrom: '2008-01-01',
  url: 'https://12366.chinatax.gov.cn/bzds/058/058-5-1.html',
}

/** Cumulative salary withholding formula and current pre-withholding table. */
export const SALARY_IIT_WITHHOLDING_RULE: FinanceCalculationRuleReference = {
  id: 'cn-salary-iit-withholding-2018-61',
  title: '个人所得税扣缴申报管理办法（试行）',
  documentNumber: '国家税务总局公告2018年第61号',
  effectiveFrom: '2019-01-01',
  url: 'https://fgk.chinatax.gov.cn/zcfgk/c100012/c5194838/content.html',
}
