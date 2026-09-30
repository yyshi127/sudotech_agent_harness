/** Subject request mapping and independent readback; no persistence, approval or network writes. */
import { z } from 'zod'
import type { SubjectPreparationInput, SubjectReferenceSelection } from './subject-preparation.ts'
import type { ReferenceResult } from './references.ts'

/**
 * Map an explicit root or existing-branch proposal and its verified accounting choices; never promote a posted leaf.
 * @param input - Validated exact proposal; maker must identify a real member of the vendor organization.
 * @param selection - Fresh current-ledger parent resolution retained with the approved version.
 * @returns Public request fields, with debit=false and credit=true as qualified by independent API/UI evidence.
 */
export function buildSubjectSubmission(input: SubjectPreparationInput, selection: SubjectReferenceSelection): object {
  const validParent = input.parentCode === null
    ? selection.parentImpact === 'new-root' && selection.parent === null
    : selection.parentImpact === 'existing-branch' && selection.parent?.code === input.parentCode
  if (!validParent) {
    throw new Error('仅支持新增一级科目或已有分支下的下级科目；父级选择必须与方案一致，不能提升已有末级。')
  }
  const accounting = selection.accounting
  if (input.accounting === undefined ? accounting !== undefined : accounting === undefined
    || JSON.stringify(input.accounting.auxiliaryCategoryCodes) !== JSON.stringify(accounting.auxiliaryCategories.map(row => row.code))
    || JSON.stringify(input.accounting.currencyCodes) !== JSON.stringify(accounting.currencies.map(row => row.code))) {
    throw new Error('科目核算配置与已核实选择不一致。')
  }
  return { subjectCode: input.subjectCode, subjectName: input.subjectName, subjectCategory: input.subjectCategory,
    subjectType: input.subjectType, balanceDirection: input.direction === 'credit',
    enableStatus: input.status === 'enabled' ? 1 : 0, documentMaker: input.documentMaker,
    accountName: selection.accountName,
    auxiliaryCategorySimpleList: accounting?.auxiliaryCategories.map(row => ({ categoryCode: row.code, checked: true })) ?? [],
    foreignCurrencySimpleList: accounting?.currencies.map(row => ({ currencyCode: row.code, checked: true })) ?? [],
    subjectAuxiliary: (accounting?.auxiliaryCategories.length ?? 0) > 0,
    ...input.numberUnit === null ? {} : { numberUnit: input.numberUnit } }
}

/** Field comparison does not prove request source identity, historical preservation or exhaustive reference coverage. */
export interface SubjectReadback {
  content: 'matched' | 'mismatch' | 'unavailable'
  configuration: 'matched' | 'mismatch' | 'unavailable'
  complete: boolean
}

const flag = z.union([z.literal('0'), z.literal('1'), z.literal(0), z.literal(1), z.boolean()])
  .transform(value => value === true || value === 1 || value === '1')
const content = z.object({ subjectCode: z.string(), subjectName: z.string(), parentSubjectCode: z.string(),
  subjectType: z.string(), balanceDirection: flag, enableStatus: flag })
const configuration = z.object({ hasChild: z.boolean(), numberUnit: z.string(),
  auxiliaryList: z.array(z.object({ id: z.union([z.string(), z.number().int()]).transform(String),
    categoryCode: z.string(), categoryName: z.string() })),
  currencyList: z.array(z.object({ currencyCode: z.string(), currencyName: z.string() })) })

/**
 * Compare the reserved subject code with independently fetched fields without converting missing values to defaults.
 * @param references - Current-ledger subject query from the same response as raw.
 * @param raw - Bounded raw array from that query, never an object returned by creation.
 * @param input - Exact sent proposal; must not be rewritten to match an unexpected result.
 * @param selection - Reserved ledger/parent identity.
 * @returns Independent scalar/configuration results; a missing or ambiguous record cannot authorize resending.
 */
export function compareSubjectReadback(references: ReferenceResult, raw: unknown, input: SubjectPreparationInput,
  selection: SubjectReferenceSelection): SubjectReadback {
  if (references.kind !== 'subjects' || references.accountId !== selection.accountId
    || references.accountName !== selection.accountName || (selection.parent?.code ?? null) !== input.parentCode) {
    return { content: 'mismatch', configuration: 'unavailable', complete: false }
  }
  const parsed = z.array(z.looseObject({ subjectCode: z.string() })).safeParse(raw)
  const rows = parsed.success ? parsed.data.filter(row => row.subjectCode === input.subjectCode) : []
  const projected = references.rows.filter(row => row.code === input.subjectCode)
  if (rows.length !== 1 || projected.length !== 1) return { content: 'unavailable', configuration: 'unavailable', complete: false }
  const fields = content.safeParse(rows[0])
  const options = configuration.safeParse(rows[0])
  const scalar = !fields.success ? 'unavailable' : fields.data.subjectName === input.subjectName
    && fields.data.parentSubjectCode === (input.parentCode ?? '') && fields.data.subjectType === input.subjectType
    && fields.data.balanceDirection === (input.direction === 'credit') && fields.data.enableStatus === (input.status === 'enabled')
    ? 'matched' : 'mismatch'
  const same = (actual: object[], expected: object[]) => JSON.stringify(actual.map(row => JSON.stringify(row)).sort())
    === JSON.stringify(expected.map(row => JSON.stringify(row)).sort())
  const configured = !options.success ? 'unavailable' : !options.data.hasChild
    && options.data.numberUnit === (input.numberUnit ?? '')
    && same(options.data.auxiliaryList, selection.accounting?.auxiliaryCategories
      .map(row => ({ id: row.id, categoryCode: row.code, categoryName: row.name })) ?? [])
    && same(options.data.currencyList, selection.accounting?.currencies
      .map(row => ({ currencyCode: row.code, currencyName: row.name })) ?? [])
    ? 'matched' : 'mismatch'
  return { content: scalar, configuration: configured, complete: scalar === 'matched' && configured === 'matched' }
}
