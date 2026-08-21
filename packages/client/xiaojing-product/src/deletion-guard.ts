/** Mandatory deletion confirmation for the Xiaojing product profile. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh'])
const DELETION_TOOL_NAME_PATTERN = /(?:^|[_-])(?:delete|remove|uninstall)(?:$|[_-])/iu
const DELETION_COMMAND_PATTERNS: readonly RegExp[] = [
  /\bRemove-[\p{L}\p{N}_-]+\b/iu,
  /\bClear-RecycleBin\b/iu,
  /\b(?:rm|ri|rmdir|unlink|shred|trash-put)\b/iu,
  /\b(?:del|erase|rd)\b(?:\s|\/)/iu,
  /\bgit\s+(?:rm|clean)\b/iu,
  /\bfind\b[\s\S]*?\s-delete\b/iu,
  /\brobocopy\b[\s\S]*?\/(?:MIR|PURGE)\b/iu,
  /\[\s*(?:System\.)?IO\.(?:File|Directory)\s*\]\s*::\s*Delete\s*\(/iu,
  /\.\s*(?:Delete|DeleteAsync|Unlink|Rm|Rmdir)\s*\(/iu,
  /\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree|fs\.(?:unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync))\s*\(/iu,
  /\b(?:powershell|pwsh)(?:\.exe)?\b[\s\S]*?-(?:EncodedCommand|enc)\b/iu,
]

/** Read the shell command from a frozen tool-argument snapshot. */
function commandOf(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  const command = (args as { readonly command?: unknown }).command
  return typeof command === 'string' ? command : undefined
}

/** Produce a bounded single-line operation preview for the confirmation UI. */
function operationPreview(command: string): string {
  const singleLine = command.replace(/\s+/gu, ' ').trim()
  return singleLine.length <= 240 ? singleLine : `${singleLine.slice(0, 237)}...`
}

/**
 * Detect a model-facing tool call that explicitly requests deletion or
 * removal. Shell detection is deliberately conservative: a false positive
 * asks for confirmation, while a false negative could destroy user data.
 * @param toolName - Registered tool name.
 * @param args - Losslessly snapshotted tool arguments.
 * @returns A user-facing mandatory-confirmation reason, or `undefined`.
 */
export function deletionApprovalReason(toolName: string, args: unknown): string | undefined {
  if (SHELL_TOOL_NAMES.has(toolName)) {
    const command = commandOf(args)
    if (command === undefined || !DELETION_COMMAND_PATTERNS.some(pattern => pattern.test(command))) return undefined
    return `删除操作必须进行本次二次确认，即使当前会话为“从不审批”也不能跳过。即将执行：${operationPreview(command)}`
  }
  if (!DELETION_TOOL_NAME_PATTERN.test(toolName)) return undefined
  return `删除操作必须进行本次二次确认，即使当前会话为“从不审批”也不能跳过。即将调用工具：${toolName}`
}

/** Map every non-grant to a distinct fail-closed tool denial. */
function denied(outcome: Exclude<ApprovalOutcome, 'allowed-once'>): PreToolDecision {
  switch (outcome) {
    case 'rejected': return { kind: 'deny', reason: '删除操作已被用户拒绝，未执行。' }
    case 'cancelled': return { kind: 'deny', reason: '删除操作确认已取消或超时，未执行。' }
    case 'unavailable': return { kind: 'deny', reason: '当前没有可用的二次确认通道，删除操作未执行。' }
  }
}

/**
 * Install the product deletion policy. The waterfall asks the user, while a
 * monotonic guard after the waterfall rejects any deletion call that did not
 * pass through that exact confirmation, including calls short-circuited by a
 * different pre-execute listener.
 * @param ctx - Product host context containing tools and approval services.
 */
export function installMandatoryDeletionGuard(ctx: Context): void {
  const confirmed = new Set<ToolExecutionToken>()

  ctx.on('tools/pre-execute', async (exec, next) => {
    const reason = deletionApprovalReason(exec.name, exec.arguments)
    if (reason === undefined) return next()
    if (exec.agent === undefined) {
      return { kind: 'deny', reason: '删除操作缺少可确认的会话身份，未执行。' }
    }
    const outcome = await ctx.approval.requestMandatory({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      reason,
      signal: exec.signal,
    })
    if (outcome !== 'allowed-once') return denied(outcome)

    confirmed.add(exec.token)
    try {
      const decision = await next()
      if (decision.kind !== 'allow') confirmed.delete(exec.token)
      return decision
    } catch (error: unknown) {
      confirmed.delete(exec.token)
      throw error
    }
  }, { prepend: true })

  ctx.tools.guard((exec: Readonly<ToolExecution>) => {
    if (deletionApprovalReason(exec.name, exec.arguments) === undefined) return undefined
    if (confirmed.delete(exec.token)) return undefined
    return '删除操作被安全策略阻止：本次调用没有完成强制二次确认。'
  })
  ctx.on('tools/result', (exec) => {
    confirmed.delete(exec.token)
  })
}
