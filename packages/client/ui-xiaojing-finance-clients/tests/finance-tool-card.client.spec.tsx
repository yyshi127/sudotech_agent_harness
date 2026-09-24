// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FinanceToolCard } from '../src/client/FinanceToolCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof zh) => zh[key]
const base = { callId: 'c1', toolName: 'finance_balances', openFile: () => undefined,
  loadImage: () => Promise.reject(new Error('unused')), t }

it('shows persisted business metadata without exposing model arguments or result JSON', () => {
  const block = {
    kind: 'tool-result', callId: 'c1', call: { name: 'finance_balances', argsRaw: '{"internalId":"secret"}' },
    content: [{ type: 'text', text: '{"coverage":"unverified"}' }], isError: false,
    meta: { kind: 'xiaojing-finance-card', title: '科目余额表', text: '账套：演示账套\n科目：1 行' },
  }
  const view = render(<FinanceToolCard {...({ ...base, block } as unknown as Parameters<typeof FinanceToolCard>[0])} />)
  expect(view.getByText('科目余额表')).toBeTruthy()
  expect(view.getByText(/科目：1 行/)).toBeTruthy()
  expect(view.queryByText(/internalId|coverage/)).toBeNull()
})

it('fails closed for missing metadata, malformed metadata, and unsuccessful calls', () => {
  const block = {
    kind: 'tool-result', callId: 'c1', call: { name: 'finance_balances', argsRaw: '{"secret":"x"}' },
    content: [{ type: 'text', text: '{"internalId":"secret"}' }], isError: false,
  }
  const view = render(<FinanceToolCard {...({ ...base, block } as unknown as Parameters<typeof FinanceToolCard>[0])} />)
  expect(view.getByText(zh.toolResultUnavailable)).toBeTruthy()
  expect(view.queryByText(/secret|internalId/)).toBeNull()
  view.rerender(<FinanceToolCard {...({ ...base, block: { ...block, isError: true,
    meta: { kind: 'xiaojing-finance-card', title: '错误的成功状态', text: 'secret' },
  } } as unknown as Parameters<typeof FinanceToolCard>[0])} />)
  expect(view.getByText(zh.toolFailed)).toBeTruthy()
  expect(view.queryByText(/secret|错误的成功状态/)).toBeNull()
  view.rerender(<FinanceToolCard {...({ ...base, block: { ...block, isError: true,
    content: [{ type: 'tool-result', toolCallId: 'c1', isError: true,
      content: [{ type: 'text', text: 'Error: 日记账资料或新增位置已变化，请重新预览确认。' }] }],
  } } as unknown as Parameters<typeof FinanceToolCard>[0])} />)
  expect(view.getByText('日记账资料或新增位置已变化，请重新预览确认。')).toBeTruthy()
  view.rerender(<FinanceToolCard {...({ ...base, block: { ...block, isError: true,
    content: [{ type: 'tool-result', toolCallId: 'c1', isError: true,
      content: [{ type: 'text', text: '余额分析须指定单个 subjectLevel，不与期间范围混用。' }] }],
  } } as unknown as Parameters<typeof FinanceToolCard>[0])} />)
  expect(view.getByText('余额分析须指定单个 科目层级，不与期间范围混用。')).toBeTruthy()
  expect(view.queryByText(/subjectLevel/)).toBeNull()
  view.rerender(<FinanceToolCard {...({ ...base, block: { ...block, isError: true,
    content: [{ type: 'tool-result', toolCallId: 'c1', isError: true,
      content: [{ type: 'text', text: 'Error: token snapshot-secret at https://example.com/finance/list' }] }],
  } } as unknown as Parameters<typeof FinanceToolCard>[0])} />)
  expect(view.queryByText(/snapshot-secret|https:\/\//)).toBeNull()
  view.rerender(<FinanceToolCard {...({ ...base, block: { ...block, isError: true,
    content: [{ type: 'text', text: '缺少 account_id 字段' }],
  } } as unknown as Parameters<typeof FinanceToolCard>[0])} />)
  expect(view.getByText(zh.toolFailed)).toBeTruthy()
  expect(view.queryByText(/account_id/)).toBeNull()
})
