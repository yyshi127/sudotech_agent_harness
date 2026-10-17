/** Mandatory deletion confirmation for the Xiaojing product profile. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalReuse } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-working-directory'
import { isAbsolute, resolve } from 'node:path'

const SHELL_TOOL_NAMES = new Set(['bash', 'pwsh'])
const DELETION_TOOL_NAME_PATTERN = /(?:^|[_-])(?:delete|remove|uninstall)(?:$|[_-])/iu
const COMMAND_START = String.raw`(?:^|[;\r\n|&({]|\$[\w:]+\s*=|\b(?:do|then|else|sudo|exec)\s)\s*`
const DELETION_COMMAND_PATTERNS: readonly RegExp[] = [
  new RegExp(`${COMMAND_START}Remove-[\\p{L}\\p{N}_-]+\\b`, 'iu'),
  new RegExp(`${COMMAND_START}Clear-RecycleBin\\b`, 'iu'),
  new RegExp(`${COMMAND_START}(?:rm|ri|rmdir|unlink|shred|trash-put)\\b`, 'iu'),
  new RegExp(`${COMMAND_START}(?:del|erase|rd)\\b(?:\\s|\\/)`, 'iu'),
  new RegExp(`${COMMAND_START}git\\s+(?:rm|clean)\\b`, 'iu'),
  new RegExp(`${COMMAND_START}find\\b[\\s\\S]*?\\s-delete\\b`, 'iu'),
  new RegExp(`${COMMAND_START}robocopy\\b[\\s\\S]*?\\/(?:MIR|PURGE)\\b`, 'iu'),
  /\[\s*(?:System\.)?IO\.(?:File|Directory)\s*\]\s*::\s*Delete\s*\(/iu,
  /\.\s*(?:Delete|DeleteAsync|Unlink|Rm|Rmdir)\s*\(/iu,
  /\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree|fs\.(?:unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync))\s*\(/iu,
]
const ENCODED_COMMAND = new RegExp(`${COMMAND_START}(?:powershell|pwsh)(?:\\.exe)?\\b[^;\\r\\n]*?-(?:EncodedCommand|enc)\\b`, 'iu')
const ENCODED_FLAG = /-(?:EncodedCommand|enc)\b/iu
const QUOTED_DELETE_COMMAND = /^(['"])(rm|ri|rmdir|unlink|shred|trash-put|del|erase|rd)\1$/iu
const COMMAND_PREFIX = new RegExp(`${COMMAND_START}$`, 'iu')
const SCRIPT_INVOCATION = new RegExp(
  `${COMMAND_START}(?:node|python3?|powershell|pwsh|cmd|bash|sh|Invoke-Expression|iex)(?:\\.exe)?\\b|(?:^|[;\\r\\n|])\\s*&`, 'iu',
)
const DELETION_TEXT = new RegExp([
  'Remove-[\\p{L}\\p{N}_-]+|Clear-RecycleBin|\\b(?:rm|ri|rmdir|unlink|shred|trash-put|del|erase|rd)\\b',
  '\\.\\s*(?:Delete|DeleteAsync|Unlink|Rm|Rmdir|rmtree|remove)\\s*\\(',
].join('|'), 'iu')

/** Mask literal text and comments without changing offsets used to read encoded arguments. */
function executableText(command: string, bash = false): string {
  let masked = ''
  let end = 0
  return command.replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@|'(?:''|[^'])*'|"(?:`[\s\S]|\\[\s\S]|[^"\\`])*"|<#[\s\S]*?#>|#[^\r\n]*/gu,
    (literal: string, _quote: string | undefined, offset: number) => {
      masked += command.slice(end, offset)
      const quotedCommand = bash && COMMAND_PREFIX.test(masked) ? QUOTED_DELETE_COMMAND.exec(literal)?.[2] : undefined
      const replacement = quotedCommand === undefined ? literal.replace(/[^\r\n]/gu, ' ') : ` ${quotedCommand} `
      masked += replacement
      end = offset + literal.length
      return replacement
    })
}

/** Decode only a literal PowerShell payload; indirect and nested scripts require execution confirmation. */
function shellReview(command: string, bash: boolean): 'deletion' | 'opaque' | undefined {
  let text = executableText(command, bash)
  if (DELETION_COMMAND_PATTERNS.some(pattern => pattern.test(text))) return 'deletion'
  const encoded = ENCODED_COMMAND.exec(text)
  if (encoded !== null) {
    const argument = /^\s*(['"]?)([A-Za-z\d+/]+={0,2})\1(?=\s|$)/u.exec(command.slice(encoded.index + encoded[0].length))?.[2]
    if (argument === undefined) return 'opaque'
    const bytes = Buffer.from(argument, 'base64')
    if (bytes.length % 2 !== 0 || bytes.toString('base64').replace(/=+$/u, '') !== argument.replace(/=+$/u, '')) return 'opaque'
    text = executableText(bytes.toString('utf16le'))
    return DELETION_COMMAND_PATTERNS.some(pattern => pattern.test(text)) ? 'deletion' : 'opaque'
  }
  if (ENCODED_FLAG.test(text)) return 'opaque'
  if (DELETION_TEXT.test(command) && (SCRIPT_INVOCATION.test(text) || /\$\(/u.test(command))) return 'opaque'
  return undefined
}

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
 * removal. Literal text and comments do not establish a deletion. Indirect
 * script effects use execution confirmation rather than a deletion claim.
 * @param toolName - Registered tool name.
 * @param args - Losslessly snapshotted tool arguments.
 * @returns A user-facing mandatory-confirmation reason, or `undefined`.
 */
export function deletionApprovalReason(toolName: string, args: unknown): string | undefined {
  if (SHELL_TOOL_NAMES.has(toolName)) {
    const command = commandOf(args)
    if (command === undefined) return undefined
    const review = shellReview(command, toolName === 'bash')
    if (review === undefined) return undefined
    return review === 'deletion'
      ? `删除操作需要二次确认。即将执行：${operationPreview(command)}`
      : `确认执行命令：无法从命令文本确认具体影响。即将执行：${operationPreview(command)}`
  }
  if (!DELETION_TOOL_NAME_PATTERN.test(toolName)) return undefined
  return `删除操作必须进行本次二次确认，即使当前会话为“从不审批”也不能跳过。即将调用工具：${toolName}`
}

/** Map every non-grant to a distinct fail-closed tool denial. */
function denied(outcome: Exclude<ApprovalOutcome, 'allowed-once'>, operation: string): PreToolDecision {
  switch (outcome) {
    case 'rejected': return { kind: 'deny', reason: `${operation}已被用户拒绝，未执行。` }
    case 'cancelled': return { kind: 'deny', reason: `${operation}确认已取消或超时，未执行。` }
    case 'unavailable': return { kind: 'deny', reason: `当前没有可用的二次确认通道，${operation}未执行。` }
  }
}

/**
 * Install the product deletion policy. The waterfall asks the user, while a
 * monotonic guard after the waterfall rejects any deletion call that did not
 * pass through that exact confirmation, including calls short-circuited by a
 * different pre-execute listener.
 * @param ctx - Product host context containing tools, approval, and working-directory services.
 */
export function installMandatoryDeletionGuard(ctx: Context): void {
  const confirmed = new Map<ToolExecutionToken, string | undefined>()

  ctx.on('tools/pre-execute', async (exec, next) => {
    const reason = deletionApprovalReason(exec.name, exec.arguments)
    if (reason === undefined) return next()
    const operation = reason.startsWith('删除操作') ? '删除操作' : '命令执行'
    if (exec.agent === undefined) {
      return { kind: 'deny', reason: `${operation}缺少可确认的会话身份，未执行。` }
    }
    const cwd = SHELL_TOOL_NAMES.has(exec.name)
      ? await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      : undefined
    const reusable = cwd === undefined ? undefined : shellAuthorization(exec, reason, cwd)
    const outcome = await ctx.approval.requestMandatory({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      reason,
      signal: exec.signal,
      ...reusable !== undefined ? { reusable } : {},
    })
    if (outcome !== 'allowed-once') return denied(outcome, operation)
    if (reusable !== undefined) await ctx.workingDirectory.ensure(exec.agent, exec.signal)

    confirmed.set(exec.token, reusable?.scope)
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
    const reason = deletionApprovalReason(exec.name, exec.arguments)
    if (reason === undefined) return undefined
    if (confirmed.has(exec.token)) {
      const scope = confirmed.get(exec.token)
      confirmed.delete(exec.token)
      if (scope === undefined || (exec.agent !== undefined
        && scope === shellAuthorization(exec, reason, ctx.workingDirectory.get(exec.agent.session))?.scope)) return undefined
      return '工作目录在确认期间发生变化，本次命令未执行，请重新发起。'
    }
    return `${reason.startsWith('删除操作') ? '删除操作' : '命令执行'}被安全策略阻止：本次调用没有完成强制二次确认。`
  })
  ctx.on('tools/result', (exec) => {
    confirmed.delete(exec.token)
  })
}

/** Authorize only the same shell command, resolved working directory, and execution permission. */
function shellAuthorization(exec: Readonly<ToolExecution>, reason: string, cwd: string): ApprovalReuse | undefined {
  if (!SHELL_TOOL_NAMES.has(exec.name) || exec.agent === undefined) return undefined
  const command = commandOf(exec.arguments)
  if (command === undefined) return undefined
  const args = exec.arguments as Record<string, unknown>
  const requested = typeof args.workdir === 'string' ? args.workdir : cwd
  const workdir = isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested)
  const label = `Repeat the same command in ${workdir}`
  return {
    category: reason.startsWith('删除操作') ? `xiaojing:shell:delete:${exec.name}` : `xiaojing:shell:execute:${exec.name}`,
    scope: JSON.stringify([exec.name, workdir, command, args.sandbox_permissions ?? 'use_default']),
    label,
    displayLabel: { en: label, zh: `同一命令，工作目录：${workdir}（命令或目录变化会重新询问）` },
  }
}
