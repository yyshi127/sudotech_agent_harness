/** Durable question and approval cancellation gates for external reimbursement writes. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'

/**
 * Reject writes while a human decision is pending or after a cancelled decision.
 * A subsequent human text message permits a new attempt, not automatic approval.
 * @param events - Authoritative session log, including question failures and approval outcomes.
 * @throws When external writes must wait for new human input.
 */
export function assertReimbursementConsent(events: readonly SessionEvent[]): void {
  const questions = new Set<string>()
  const approvals = new Set<string>()
  let cancelled = false
  for (const event of events) {
    if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data.source.kind === 'user'
      && event.data.content.some(block => block.type === 'text' && block.text.trim() !== '')) {
      cancelled = false
    } else if (event.type === 'tool/call' && event.data.name === 'ask_user_question') {
      questions.add(event.data.callId)
    } else if (event.type === 'tool/result' && questions.delete(event.data.message.source.callId)) {
      if (event.data.message.isError) cancelled = true
    } else if (event.type === 'approval/asked' && event.data.toolName === 'finance_reimbursement') {
      approvals.add(event.data.id)
    } else if (event.type === 'approval/decided' && approvals.delete(event.data.id)) {
      if (event.data.outcome !== 'allowed-once') cancelled = true
    }
  }
  if (cancelled || questions.size > 0 || approvals.size > 0) {
    throw new Error('用户确认尚未完成或已取消：暂停报销及附件写入，等待用户新的明确指令。不得猜测、合并发票或更换模板；再次创建仍需逐单确认。')
  }
}
