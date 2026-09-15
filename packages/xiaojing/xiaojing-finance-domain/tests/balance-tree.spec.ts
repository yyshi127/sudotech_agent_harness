import { expect, it, vi } from 'vitest'
import { readBalanceTree } from '../src/balance-tree.ts'

const root = { subjectCode: '1101', subjectName: '投资', subjectLevel: 1, subjectInfoId: 1, parentSubjectId: 0, hasChild: true,
  periodInitialBorrow: '1000.00', periodInitialLoan: '', periodInitialBalance: '',
  periodThisBorrow: '', periodThisLoan: '', periodThisBalance: '',
  periodYearBorrow: '', periodYearLoan: '', periodYearBalance: '',
  periodFinalBorrow: '1000.00', periodFinalLoan: '', periodFinalBalance: '' }
const child = { ...root, subjectCode: '110101', subjectName: '股票', subjectLevel: 2, subjectInfoId: 2, parentSubjectId: 1, hasChild: false }
const summary = { ...root, subjectCode: '', subjectName: '本期合计' }
const page = (list: unknown[]) => ({ success: true, count: 0, list })
const query = { month: '2026-09', subjectLevel: 1, subjectLevelEnd: 4 }
const account = { id: '35601', name: '测试' }

it('fetches children missing from the first response and retains only root summaries and unknown values', async () => {
  const read = vi.fn().mockResolvedValueOnce(page([root, summary])).mockResolvedValueOnce(page([child, summary]))
  const result = await readBalanceTree(query, account, read, new AbortController().signal, 10, 65536)
  expect(read.mock.calls).toEqual([[1, 0], [2, 1]])
  expect(result.rows.map(row => row.subjectCode)).toEqual(['1101', '110101'])
  expect(result.summaries).toHaveLength(1)
  expect(result.rows[1]?.periodThisBorrow).toBeNull()
  expect(result.coverage).toBe('unverified')
})

it.each([
  [], [{ ...child, parentSubjectId: 9 }], [{ ...child, subjectInfoId: 1 }],
  [{ ...child, subjectCode: root.subjectCode }], [{ ...child, subjectInfoId: undefined }],
  [{ ...child, subjectLevel: 3 }], [child, child],
].map(children => ({ children })))('rejects missing, duplicate and misassociated child rows', async ({ children }) => {
  const read = vi.fn().mockResolvedValueOnce(page([root])).mockResolvedValueOnce(page(children))
  await expect(readBalanceTree(query, account, read, new AbortController().signal, 10, 65536)).rejects.toThrow()
})

it('stops at the requested level and rejects combined limits or a failed child request', async () => {
  const read = vi.fn().mockResolvedValueOnce(page([root, summary]))
  const selected = { ...query, subjectLevelEnd: 1 }
  expect((await readBalanceTree(selected, account, read, new AbortController().signal, 10, 65536)).rows).toHaveLength(1)
  expect(read).toHaveBeenCalledTimes(1)
  const bounded = vi.fn().mockResolvedValueOnce(page([root, summary])).mockResolvedValueOnce(page([child]))
  await expect(readBalanceTree(query, account, bounded, new AbortController().signal, 2, 65536)).rejects.toThrow('上限')
  const failed = vi.fn().mockResolvedValueOnce(page([root])).mockRejectedValueOnce(new Error('child failed'))
  await expect(readBalanceTree(query, account, failed, new AbortController().signal, 10, 65536)).rejects.toThrow('child failed')
})

it('checks cancellation after a branch before fetching or returning further data', async () => {
  const controller = new AbortController()
  const read = vi.fn(async () => { controller.abort(); return page([root]) })
  await expect(readBalanceTree(query, account, read, controller.signal, 10, 65536)).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(1)
})
