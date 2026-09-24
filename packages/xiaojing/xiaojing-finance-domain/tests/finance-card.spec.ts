import { expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { withFinanceCard } from '../src/finance-card.ts'

it('stores the Host business summary without modifying model-facing content', () => {
  const tool = withFinanceCard(defineTool({
    name: 'finance_card_test', description: 'test', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => '{"internalId":"secret"}',
    presentResult: () => ({ card: 'generic', title: '余额查询', content: [{ type: 'text', text: '科目：1 行' }] }),
  }))
  const value = '{"internalId":"secret"}'
  expect(tool.output.render({}, value)).toEqual([{ type: 'text', text: value }])
  expect(tool.output.presentationMeta?.({}, value)).toEqual({
    kind: 'xiaojing-finance-card', title: '余额查询', text: '科目：1 行',
  })
})
