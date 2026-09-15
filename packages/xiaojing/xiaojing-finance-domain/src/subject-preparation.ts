/** Local subject proposals and parent/duplicate checks; no write mapping or historical-data migration. */
import { z } from 'zod'
import type { ReferenceResult, ReferenceRow } from './references.ts'

const code = z.string().regex(/^[1-5]\d{3}(?:\d{2}){0,3}$/)
const text = z.string().trim().min(1).max(500)
const codes = z.array(text).refine(values => new Set(values).size === values.length, '核算配置编码不能重复。')
const schema = z.strictObject({ subjectCode: code, subjectName: z.string().trim().min(1).max(20),
  parentCode: code.nullable(), subjectCategory: z.enum(['1', '2', '3', '4', '5']), subjectType: text,
  direction: z.enum(['debit', 'credit']), status: z.enum(['enabled', 'disabled']),
  documentMaker: text, numberUnit: z.string().trim().min(1).max(10).nullable(),
  accounting: z.strictObject({ auxiliaryCategoryCodes: codes, currencyCodes: codes }).optional(),
}).superRefine((value, ctx) => {
  const expectedParent = value.subjectCode.length === 4 ? null : value.subjectCode.slice(0, -2)
  if (value.parentCode !== expectedParent) ctx.addIssue({ code: 'custom', path: ['parentCode'], message: '父科目必须与4-2-2-2编码层级一致。' })
  if (!value.subjectCode.startsWith(value.subjectCategory)) ctx.addIssue({ code: 'custom', path: ['subjectCategory'], message: '科目总分类与编码首位不一致。' })
})

/** Explicit creation choices; omitted accounting retains ordinary unconfigured subject behavior. */
export type SubjectPreparationInput = z.infer<typeof schema>

/** Current-ledger identities and labels retained with exact-version accounting selections. */
export const subjectAccountingSelectionSchema = z.strictObject({
  auxiliaryCategories: z.array(z.strictObject({ id: text.transform(value => value as ReferenceRow['id']), code: text, name: text })),
  currencies: z.array(z.strictObject({ code: text, name: text })),
})

/**
 * Validate a complete model or durable JSON proposal without inferring accounting choices.
 * @param input - Explicit scalar values; account, credentials, IDs and raw direction flags are rejected.
 * @param maxBytes - UTF-8 byte limit for the complete normalized proposal.
 * @returns Validated proposal; direction remains semantic rather than a vendor boolean.
 */
export function validateSubjectPreparation(input: unknown, maxBytes: number): SubjectPreparationInput {
  const value = schema.parse(input)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw new Error('科目准备内容超过大小限制。')
  return value
}

/** Parent and name findings that a later full preview must retain; not permission to create. */
export interface SubjectReferenceSelection {
  accountId: string
  accountName: string
  parent: { code: string; name: string } | null
  parentImpact: 'new-root' | 'existing-branch' | 'requires-leaf-promotion-check'
  sameNameElsewhere: { code: string; parentCode?: string }[]
  accounting?: z.infer<typeof subjectAccountingSelectionSchema> | undefined
}

/**
 * Resolve explicit accounting choices from the current ledger without treating subject currencies as a complete catalog.
 * @param input - Exact proposal; no omitted choice enables accounting.
 * @param subjects - Unfiltered current-ledger subjects with observed currency codes and names in raw.
 * @param raw - Bounded raw subject array from the same response.
 * @param categories - Fresh unfiltered auxiliary categories from the same ledger, when requested.
 * @returns Captured names and identities; missing or conflicting references reject instead of guessing.
 */
export function resolveSubjectAccounting(input: SubjectPreparationInput, subjects: ReferenceResult, raw: unknown,
  categories: ReferenceResult | undefined): SubjectReferenceSelection['accounting'] {
  if (input.accounting === undefined) return undefined
  if (subjects.kind !== 'subjects' || subjects.selection !== 'not-requested') throw new Error('科目核算配置需要当前账套未筛选资料。')
  const auxiliaryCategories = input.accounting.auxiliaryCategoryCodes.map((code) => {
    if (categories?.kind !== 'auxiliary-categories' || categories.accountId !== subjects.accountId
      || categories.accountName !== subjects.accountName || categories.selection !== 'not-requested') {
      throw new Error('辅助核算类别必须来自当前账套。')
    }
    const matches = categories.rows.filter(row => row.code === code)
    const row = matches[0]
    if (matches.length !== 1 || row === undefined || row.status === 'disabled') throw new Error('辅助核算类别未唯一核实或已停用。')
    return { id: row.id, code: row.code, name: row.name }
  })
  const observed = z.array(z.object({ currencyList: z.array(z.object({ currencyCode: text, currencyName: text })).nullish() })).parse(raw)
    .flatMap(row => row.currencyList ?? [])
  const currencies = input.accounting.currencyCodes.map((code) => {
    const names = new Set(observed.filter(row => row.currencyCode === code).map(row => row.currencyName))
    const name = [...names][0]
    if (names.size !== 1 || name === undefined) throw new Error('币种尚未在当前账套科目中唯一核实；不自动注册币种或猜测汇率。')
    return { code, name }
  })
  return { auxiliaryCategories, currencies }
}

/**
 * Resolve an enabled parent without treating incomplete reference coverage as proof of absence.
 * @param input - Structurally validated proposal.
 * @param account - Independently verified current ledger.
 * @param subjects - Unfiltered returned references for that ledger.
 * @returns Parent impact and same-name peers; missing/ambiguous parents, duplicate codes and sibling names reject.
 */
export function resolveSubjectReferences(input: SubjectPreparationInput, account: { id: string; name: string },
  subjects: ReferenceResult): SubjectReferenceSelection {
  if (subjects.kind !== 'subjects' || subjects.accountId !== account.id || subjects.accountName !== account.name
    || subjects.selection !== 'not-requested') throw new Error('新增科目必须使用当前账套未筛选的科目资料。')
  if (subjects.rows.some(row => row.code === input.subjectCode)) throw new Error('科目编码已存在，不能覆盖或修改已有科目。')
  const sameNames = subjects.rows.filter(row => row.name === input.subjectName)
  if (sameNames.some(row => (row.parentCode ?? '') === (input.parentCode ?? ''))) {
    throw new Error('同一父级下已有同名科目，请先核对已有资料。')
  }
  const sameNameElsewhere = sameNames.map(row => ({ code: row.code,
    ...row.parentCode === undefined ? {} : { parentCode: row.parentCode },
  }))
  if (input.parentCode === null) return { accountId: account.id, accountName: account.name,
    parent: null, parentImpact: 'new-root', sameNameElsewhere }
  const parents = subjects.rows.filter(row => row.code === input.parentCode)
  const parent = parents[0]
  if (parents.length !== 1 || parent === undefined) throw new Error('父科目不存在或不唯一，不会自动新增父科目。')
  if (parent.status !== 'enabled') throw new Error('父科目未确认启用，不能新增下级。')
  return { accountId: account.id, accountName: account.name, parent: { code: parent.code, name: parent.name },
    parentImpact: parent.hasChildren === true ? 'existing-branch' : 'requires-leaf-promotion-check', sameNameElsewhere }
}
