import { expect, it } from 'vitest'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { assertReimbursementConsent } from '../src/reimbursement-consent.ts'

const callId = CallId('question')
const question: SessionEvent = { type: 'tool/call', seq: 1, time: 0,
  data: { turn: 1, step: 1, callId, name: 'ask_user_question', arguments: '{}' } }
const answer = (isError: boolean): SessionEvent => ({ type: 'tool/result', seq: 2, time: 0, surfaceOp: 'append',
  data: { turn: 1, step: 1, message: createToolResultMessage({ callId, isError, content: [{ type: 'text', text: isError ? 'cancelled' : 'answer' }] }) } })
const human = (text: string): SessionEvent<'user/message'> => ({ type: 'user/message', seq: 3, time: 0, surfaceOp: 'append',
  data: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }) })

it('blocks pending or failed questions, but not answered questions or unrelated tool failures', () => {
  expect(() => { assertReimbursementConsent([question]) }).toThrow('暂停')
  expect(() => { assertReimbursementConsent([question, answer(true)]) }).toThrow('暂停')
  expect(() => { assertReimbursementConsent([question, answer(false)]) }).not.toThrow()
  expect(() => { assertReimbursementConsent([{ ...question, data: { ...question.data, name: 'finance_document' } }, answer(true)]) }).not.toThrow()
})

it('requires new human text after cancellation; blank input and surface replacement do not resume writes', () => {
  const cancelled = [question, answer(true)]
  expect(() => { assertReimbursementConsent([...cancelled, human('')]) }).toThrow('暂停')
  expect(() => { assertReimbursementConsent([...cancelled, { ...human('continue'), surfaceOp: { op: 'replace', start: 1, end: 1 } }]) }).toThrow('暂停')
  expect(() => { assertReimbursementConsent([...cancelled, human('确认本次信息，继续保存草稿')]) }).not.toThrow()
  expect(() => { assertReimbursementConsent([question, human('continue')]) }).toThrow('暂停')
})

it.each(['rejected', 'cancelled', 'unavailable', 'allowed-once'] as const)('honors the durable reimbursement approval outcome %s', (outcome) => {
  const id = ApprovalRequestId('approval')
  const asked: SessionEvent = { type: 'approval/asked', seq: 1, time: 0, data: { id, toolName: 'finance_reimbursement' } }
  const decided: SessionEvent = { type: 'approval/decided', seq: 2, time: 0, data: { id, outcome } }
  expect(() => { assertReimbursementConsent([asked]) }).toThrow('暂停')
  const check = () => { assertReimbursementConsent([asked, decided]) }
  if (outcome === 'allowed-once') expect(check).not.toThrow()
  else expect(check).toThrow('暂停')
  expect(() => { assertReimbursementConsent([asked, decided, human('重新确认并继续')]) }).not.toThrow()
})
