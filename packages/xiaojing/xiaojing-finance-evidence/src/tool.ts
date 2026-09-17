/** Finance-preset tool for auditable official finance-tax evidence retrieval. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { FinanceEvidenceItem, FinanceEvidenceResult } from './types.ts'

/** Loader-visible plugin name. */
export const name = 'xiaojing-finance-evidence-tool'

/** Required services for the Finance evidence consumer. */
export const inject = ['tools', 'xiaojingFinanceEvidence']

function field(label: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`  - ${label}：${value}`]
}

function renderItem(item: FinanceEvidenceItem, index: number): string {
  return [
    `${index + 1}. [${item.title}](${item.url})`,
    `  - 来源：${item.authority}（${item.authorityLevel}）`,
    `  - 证据状态：${item.role === 'official-text' ? '已取得官方正文' : '仅发现线索'}；${item.lifecycle}；${item.legalEffect}`,
    ...field('文号', item.documentNumber),
    ...field('发布日期', item.publicationDate),
    ...field('生效日期', item.effectiveFrom),
    ...field('失效日期', item.effectiveTo),
    ...field('官方正文摘录', item.excerpt),
    ...item.limitations.map(limitation => `  - 限制：${limitation}`),
  ].join('\n')
}

/**
 * Render the evidence result for the model-visible tool transcript.
 * @param result - Structured result.
 * @returns Markdown evidence report.
 */
export function renderFinanceEvidence(result: FinanceEvidenceResult): string {
  const status = {
    verified: '已核验',
    partial: '部分核验',
    pending: '待核验',
    'out-of-scope': '超出中国大陆范围',
  }[result.status]
  return [
    `## 官方财税依据：${status}`,
    '',
    `- 依据日期：${result.asOfDate}`,
    `- 地区：${result.locality ?? '未指定（仅国家层级）'}`,
    `- 核验时间：${result.checkedAt}`,
    ...result.assumptions.map(value => `- 前提：${value}`),
    ...result.warnings.map(value => `- 提醒：${value}`),
    '',
    ...result.evidence.length === 0
      ? ['没有取得可引用的官方依据。']
      : result.evidence.map(renderItem),
  ].join('\n')
}

/** Register the Finance-only evidence tool. @param ctx - Finance agent scope. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'finance_evidence',
    description: [
      'Verify current or date-specific Chinese mainland finance, tax, invoice, and accounting-policy claims against configured official sources.',
      'Call this before giving a definitive rule-dependent answer. Search snippets are discovery only; use only items marked 已取得官方正文 as evidence.',
      'If the result is 部分核验 or 待核验, label the affected proposition 待核验 instead of inventing a rule, date, rate, threshold, document number, or citation.',
      'If the result is 已核验, keep the verified proposition and its client-specific applicability as separate conclusions; do not relabel that same proposition 待核验 merely because client facts still need confirmation.',
      'The service does not cover Hong Kong, Macao, Taiwan, or foreign jurisdictions and does not prove that a conditional rule applies to every client fact.',
    ].join(' '),
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Focused policy question, tax type, policy title, document number, or operative condition to verify.',
      },
      as_of_date: {
        type: 'string',
        description: 'Optional rule-evaluation date in YYYY-MM-DD; defaults to the current Beijing date.',
      },
      locality: {
        type: 'string',
        description: 'Optional Mainland locality. A bound client defaults this from its immutable registered-region snapshot.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['verified', 'partial', 'pending', 'out-of-scope'] },
          query: { type: 'string', required: true },
          asOfDate: { type: 'string', required: true },
          jurisdiction: { type: 'string', required: true, enum: ['中国大陆'] },
          locality: { type: 'string' },
          localitySource: { type: 'string', required: true, enum: ['request', 'client', 'none'] },
          checkedAt: { type: 'string', required: true },
          evidence: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sourceId: { type: 'string', required: true },
                authority: { type: 'string', required: true },
                authorityLevel: { type: 'string', required: true, enum: ['L0', 'L1', 'L2', 'L3'] },
                title: { type: 'string', required: true },
                documentNumber: { type: 'string' },
                publicationDate: { type: 'string' },
                effectiveFrom: { type: 'string' },
                effectiveTo: { type: 'string' },
                lifecycle: { type: 'string', required: true, enum: ['current', 'historical', 'future', 'repealed', 'draft', 'amended', 'transitional', 'unverified'] },
                legalEffect: { type: 'string', required: true, enum: ['law', 'administrative-regulation', 'departmental-rule', 'normative-document', 'official-guidance', 'unknown'] },
                applicability: { type: 'string', required: true, enum: ['national-conditional', 'local-conditional', 'background-only', 'unverified'] },
                role: { type: 'string', required: true, enum: ['official-text', 'discovery-only'] },
                url: { type: 'string', required: true },
                retrievedAt: { type: 'string' },
                sha256: { type: 'string' },
                excerpt: { type: 'string' },
                retrieval: { type: 'string', required: true, enum: ['network', 'cache', 'not-fetched'] },
                rightsStatus: { type: 'string', required: true, enum: ['terms-review-pending'] },
                limitations: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          assumptions: { type: 'array', required: true, items: { type: 'string' } },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      // The JSON schema validates the wire value; the brand on sourceId is
      // compile-time-only and cannot be expressed by the tool schema.
      render: (_args, value) => [{ type: 'text', text: renderFinanceEvidence(value as FinanceEvidenceResult) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('finance_evidence requires an owning Finance agent session')
      return await ctx.xiaojingFinanceEvidence.research(exec.agent, {
        query: args.query,
        ...args.as_of_date === undefined ? {} : { asOfDate: args.as_of_date },
        ...args.locality === undefined ? {} : { locality: args.locality },
      }, exec.signal)
    },
    presentCall: () => ({
      card: 'generic',
      title: '核验官方财税依据',
      kind: 'search',
    }),
  }))
}
