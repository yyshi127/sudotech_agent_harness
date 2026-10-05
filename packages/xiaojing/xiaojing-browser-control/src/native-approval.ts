/** Xiaojing confirmations around the native Playwright and DevTools browser tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { ApprovalReuse } from '@deepseek-ai/dsh-user-approval'
import { privateDestination } from './index.ts'

/** Exact native connection whose calls and snapshots this policy owns. */
export interface NativeBrowserGuardOptions {
  readonly prefix: string
  readonly browser: 'edge' | 'chrome'
  readonly surface: 'managed' | 'existing'
  readonly owner: Agent
  readonly allowPrivateHosts: boolean
}

const DELETION = /delete|remove|uninstall|erase|删除|移除|卸载|清空/iu
const EXTERNAL_IMPACT = new RegExp([
  '\\b(?:submit|send|publish|post|save|approve|pay|purchase|buy|transfer|sign|refund|void|reconcile)\\b',
  '提交|发送|发布|保存|支付|购买|转账|签署|下单|审批|审核|过账|结账|记账|冲销|退款|作废|撤销',
].join('|'), 'iu')
const CONFIRMATION = /\b(?:confirm|ok|yes)\b|确认|确定/iu
const PASSWORD = /password|密码|口令/iu
const TARGET_ACTIONS = new Set([
  'browser_click', 'browser_drag', 'browser_type', 'browser_select_option', 'browser_fill_form', 'browser_check', 'browser_uncheck',
  'click', 'drag', 'fill', 'fill_form',
])
const EDIT_ACTIONS = new Set(['browser_type', 'browser_fill_form', 'fill', 'fill_form'])
const CODE_ACTIONS = new Set(['browser_evaluate', 'evaluate_script', 'evaluate', 'execute_webmcp_tool', 'execute_3p_developer_tool'])
const APPROVAL_ZH: Readonly<Record<string, string>> = {
  'Upload files or data to the current website': '向当前网站上传文件或数据',
  'Execute browser code or coordinate actions whose effects cannot be verified from observed controls': '执行浏览器脚本或坐标操作，可能读取或修改网页内容',
  'Accept the current website confirmation dialog': '接受当前网站的确认对话框',
  'Send a potentially destructive key to the current website': '向当前网页发送可能删除内容的按键',
  'Submit or activate the focused website control': '提交或触发当前聚焦的网页控件',
  'Send keys to a focused website control whose effects have not been verified': '向尚未确认影响的网页控件发送按键',
  'Type into a focused website control that has not been verified': '向尚未确认的网页控件输入内容',
  'Perform a browser action whose effects have not been verified': '执行影响尚未确认的浏览器操作',
  'Operate a website control that has not been verified in the current accessibility snapshot': '操作当前页面中尚未确认的网页控件',
  'Read or operate a browser page whose destination has not been verified': '读取或操作地址尚未确认的浏览器页面',
}
const READ_OR_NAVIGATION_ACTIONS = new Set([
  'browser_snapshot', 'browser_take_screenshot', 'browser_console_messages', 'browser_network_requests', 'browser_network_request',
  'browser_navigate', 'browser_navigate_back', 'browser_navigate_forward', 'browser_reload', 'browser_tabs', 'browser_close',
  'browser_wait_for', 'browser_resize', 'browser_hover', 'browser_find', 'browser_get_config', 'browser_generate_locator',
  'browser_cookie_list', 'browser_cookie_get', 'browser_localstorage_list', 'browser_localstorage_get', 'browser_sessionstorage_list',
  'browser_sessionstorage_get', 'browser_route_list', 'browser_storage_state', 'browser_verify_element_visible', 'browser_verify_text_visible',
  'browser_verify_list_visible', 'browser_verify_value',
  'list_pages', 'select_page', 'close_page', 'new_page', 'navigate_page', 'navigate', 'take_snapshot', 'take_screenshot', 'screenshot',
  'wait_for', 'hover', 'resize_page', 'list_console_messages', 'get_console_message', 'list_network_requests', 'get_network_request',
  'get_tab_id', 'list_webmcp_tools', 'list_3p_developer_tools',
])

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

/**
 * Read native accessibility references with their enclosing dialog or row labels.
 * @param content - Model-visible native result blocks, already recorded by the tool runtime.
 * @returns Labels issued by this snapshot; model-supplied element descriptions are not used.
 */
export function nativeSnapshotLabels(content: readonly ContentBlock[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const block of content) {
    if (block.type !== 'text') continue
    const parents: Array<{ indent: number; label: string }> = []
    for (const line of block.text.split('\n')) {
      const row = /^(\s*)(?:-\s+|uid=([\w-]+)\s+)(.+)/u.exec(line)
      if (row === null) continue
      const [, spacing, , rowLabel] = row
      if (spacing === undefined || rowLabel === undefined) continue
      const indent = spacing.length
      while ((parents.at(-1)?.indent ?? -1) >= indent) parents.pop()
      const reference = /\s+\[ref=([\w-]+)\]/u.exec(rowLabel)
      const label = reference === null ? rowLabel : rowLabel.slice(0, reference.index)
      const id = row[2] ?? reference?.[1]
      if (id !== undefined) labels.set(id, [...parents.map(parent => parent.label), label].join(' / '))
      if (/^(?:dialog|alertdialog|row|form|region)\b/iu.test(label)) parents.push({ indent, label })
    }
  }
  return labels
}

function targetLabels(action: string, args: Record<string, unknown>, labels: ReadonlyMap<string, string>): Array<string | undefined> {
  const fields = action === 'browser_fill_form' ? args.fields : action === 'fill_form' ? args.elements : undefined
  if (Array.isArray(fields)) return fields.map((field) => {
    const item = record(field)
    const target = action === 'fill_form' ? item.uid : item.target ?? item.ref
    return typeof target === 'string' ? labels.get(target) : undefined
  })
  const targets = action === 'drag' ? [args.from_uid, args.to_uid]
    : action === 'browser_drag' ? [args.startTarget ?? args.startRef, args.endTarget ?? args.endRef]
      : action.startsWith('browser_') ? [args.target ?? args.ref] : [args.uid]
  return targets.filter(value => value !== undefined).map(target => typeof target === 'string' ? labels.get(target) : undefined)
}

/**
 * Classify native actions using observed controls rather than model-written labels.
 * @param action - Upstream native tool name without its connection prefix.
 * @param input - Frozen native tool arguments.
 * @param labels - Accessibility labels from this connection's last complete snapshot.
 * @returns Confirmation reason, or undefined for an ordinary read or edit.
 */
export function nativeBrowserApprovalReason(action: string, input: unknown, labels: ReadonlyMap<string, string>): string | undefined {
  const args = record(input)
  if (action === 'browser_file_upload' || action === 'browser_drop' || action === 'upload_file') return 'Upload files or data to the current website'
  if (CODE_ACTIONS.has(action) || action.startsWith('browser_run_code') || action.startsWith('browser_mouse_') || action === 'click_at'
    || typeof args.initScript === 'string') {
    return 'Execute browser code or coordinate actions whose effects cannot be verified from observed controls'
  }
  if (action === 'browser_handle_dialog' || action === 'handle_dialog') {
    return args.accept === true || args.action === 'accept' ? 'Accept the current website confirmation dialog' : undefined
  }
  if (action === 'browser_press_key' || action === 'press_key') {
    const key = typeof args.key === 'string' ? args.key : ''
    if (/delete|backspace/iu.test(key)) return 'Send a potentially destructive key to the current website'
    if (/enter/iu.test(key)) return 'Submit or activate the focused website control'
    return /^(?:Escape|Tab|Shift\+Tab|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/iu.test(key)
      ? undefined : 'Send keys to a focused website control whose effects have not been verified'
  }
  if (action === 'type_text' || action === 'browser_press_sequentially') return 'Type into a focused website control that has not been verified'
  if (!TARGET_ACTIONS.has(action)) {
    return READ_OR_NAVIGATION_ACTIONS.has(action) ? undefined : 'Perform a browser action whose effects have not been verified'
  }
  const observed = targetLabels(action, args, labels)
  if (observed.length === 0 || observed.some(label => label === undefined)) {
    return 'Operate a website control that has not been verified in the current accessibility snapshot'
  }
  const combined = observed.join(' / ')
  if (DELETION.test(combined)) return `Activate destructive browser control “${combined}”`
  if (EXTERNAL_IMPACT.test(combined) || CONFIRMATION.test(combined) || (action === 'browser_type' && args.submit === true)) {
    return `Activate external-impact browser control “${combined}”`
  }
  return undefined
}

/** Classify browser-wide scripts and coordinates, or uniquely observed controls on an HTTP(S) origin. */
function controlAuthorization(
  options: NativeBrowserGuardOptions,
  action: string,
  args: Record<string, unknown>,
  labels: ReadonlyMap<string, string>,
  observedUrl: string | undefined,
): ApprovalReuse | undefined {
  const code = CODE_ACTIONS.has(action) || action.startsWith('browser_run_code')
  const coordinates = action.startsWith('browser_mouse_') || action === 'click_at'
  if (code || coordinates) {
    const browser = options.browser === 'edge' ? 'Edge' : 'Chrome'
    const route = options.surface === 'existing' ? '已打开的' : '专用'
    const operation = code ? '脚本执行' : '坐标操作'
    const label = `${browser} ${options.surface}: ${code ? 'scripts' : 'coordinates'} across the entire connected browser`
    return {
      category: `xiaojing:browser:${code ? 'script' : 'coordinates'}`,
      scope: JSON.stringify([options.browser, options.surface]),
      label,
      displayLabel: { en: label, zh: `${browser} ${route}整个浏览器的${operation}，可能读取或修改页面内容` },
    }
  }
  if (!TARGET_ACTIONS.has(action) || observedUrl === undefined || args.url !== undefined || typeof args.initScript === 'string') return undefined
  const url = new URL(observedUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  const observed = targetLabels(action, args, labels)
  if (observed.length === 0 || observed.some(label => label === undefined
    || [...labels.values()].filter(candidate => candidate === label).length !== 1)) return undefined
  const operation = action === 'browser_click' || action === 'click' ? 'activate'
    : action === 'browser_drag' || action === 'drag' ? 'drag'
      : EDIT_ACTIONS.has(action) ? args.submit === true ? 'submit' : 'edit' : action
  const browser = options.browser === 'edge' ? 'Edge' : 'Chrome'
  const controls = observed.join(' / ')
  const label = `${browser}: ${operation} “${controls}” on ${url.origin}`
  return {
    category: `xiaojing:browser:${operation}`,
    scope: JSON.stringify([options.browser, options.surface, url.origin, observed]),
    label,
    displayLabel: { en: label, zh: `${browser}：在 ${url.origin} 对“${controls}”执行同类操作（${operation}）` },
  }
}

/** Present owned approval explanations in Chinese without changing logged model-facing reasons. */
function localizedApprovalReason(reason: string): { en: string; zh: string } {
  let zh = APPROVAL_ZH[reason]
  for (const [prefix, label] of [
    ['Activate destructive browser control ', '删除或移除网页中的内容：'],
    ['Activate external-impact browser control ', '提交、发送或保存网页内容：'],
    ['Read or operate local browser destination ', '访问本地浏览器页面：'],
    ['Read or operate private or local browser destination ', '访问本机或内网网页：'],
  ] as const) {
    if (reason.startsWith(prefix)) zh = label + reason.slice(prefix.length)
  }
  return { en: reason, zh: zh ?? '执行影响尚未确认的浏览器操作，请确认是否允许。' }
}

/**
 * Preserve mandatory confirmations and private-destination checks around native calls.
 * Admission is checked again by the executor even when another policy short-circuits.
 * @param ctx - Agent-scoped native connection with tools and approval services.
 * @param options - Connection identity, live owner, and test-only private-host exception.
 */
export function installNativeBrowserGuard(ctx: Context, options: NativeBrowserGuardOptions): void {
  let labels = new Map<string, string>()
  let labelsPage: number | undefined
  let currentUrl: string | undefined
  let currentPage: number | undefined
  let pages = new Map<number, string>()
  const admitted = new Set<ToolExecutionToken>()
  const pendingHosts = new Map<ToolExecutionToken, string>()
  const approvedHosts = new Set<string>()

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!exec.name.startsWith(options.prefix)) return next()
    if (exec.agent !== options.owner) return { kind: 'deny', reason: 'Browser connection belongs to another Session' }
    const action = exec.name.slice(options.prefix.length)
    const args = record(exec.arguments)
    const requestedPage = typeof args.pageId === 'number' ? args.pageId : currentPage
    const observedLabels = requestedPage === labelsPage ? labels : new Map<string, string>()
    const observed = targetLabels(action, args, observedLabels)
    if (EDIT_ACTIONS.has(action) && observed.some(label => label !== undefined && PASSWORD.test(label))) {
      return { kind: 'deny', reason: 'Enter website passwords manually in the browser' }
    }
    let reason = nativeBrowserApprovalReason(action, exec.arguments, observedLabels)
    let approvedHost: string | undefined
    const selecting = action === 'select_page' || action === 'browser_tabs' && args.action === 'select'
    const selectedPage = action === 'select_page' ? args.pageId : args.index
    const metadataOnly = action === 'list_pages' || action === 'browser_close' || action === 'close_page'
      || action === 'browser_tabs' && (args.action === 'list' || args.action === 'close' || args.action === 'new' && args.url === undefined)
    const destination = typeof args.url === 'string' ? args.url
      : selecting ? typeof selectedPage === 'number' ? pages.get(selectedPage) : undefined
        : typeof args.pageId === 'number' ? pages.get(args.pageId) : currentUrl
    if (!options.allowPrivateHosts && !metadataOnly && destination === undefined) {
      reason ??= 'Read or operate a browser page whose destination has not been verified'
    }
    if (!options.allowPrivateHosts && !metadataOnly && destination !== undefined && destination !== 'about:blank') {
      const parsed = new URL(destination)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reason ??= `Read or operate local browser destination ${parsed.protocol}`
      } else {
        const host = await privateDestination(destination)
        if (host !== undefined && !approvedHosts.has(host)) {
          approvedHost = host
          reason ??= `Read or operate private or local browser destination ${host}`
        }
      }
    }
    if (reason !== undefined) {
      const observedUrl = typeof args.pageId === 'number' ? pages.get(args.pageId) : currentUrl
      const reusable = controlAuthorization(options, action, args, observedLabels, observedUrl)
      const outcome = await ctx.approval.requestMandatory({
        agent: options.owner, toolName: exec.name, callId: exec.callId, reason, signal: exec.signal,
        displayReason: localizedApprovalReason(reason),
        ...reusable !== undefined ? { reusable } : {},
      })
      if (outcome !== 'allowed-once') return { kind: 'deny', reason: `Browser operation was not confirmed (${outcome})` }
    }
    admitted.add(exec.token)
    if (approvedHost !== undefined) pendingHosts.set(exec.token, approvedHost)
    try {
      const decision = await next()
      if (decision.kind !== 'allow') {
        admitted.delete(exec.token)
        pendingHosts.delete(exec.token)
      }
      return decision
    } catch (error) {
      admitted.delete(exec.token)
      pendingHosts.delete(exec.token)
      throw error
    }
  }, { prepend: true })
  ctx.tools.guard((exec) => {
    if (!exec.name.startsWith(options.prefix)) return undefined
    return exec.agent === options.owner && admitted.delete(exec.token) ? undefined : 'Browser operation did not pass its confirmation policy'
  })
  ctx.on('tools/result', (exec, result) => {
    admitted.delete(exec.token)
    const approvedHost = pendingHosts.get(exec.token)
    pendingHosts.delete(exec.token)
    if (!exec.name.startsWith(options.prefix) || exec.agent !== options.owner || result.isError) return
    const action = exec.name.slice(options.prefix.length)
    const args = record(exec.arguments)
    const nextLabels = nativeSnapshotLabels(result.content)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const pageChanged = action === 'browser_close' || action === 'select_page' || action === 'close_page' || action === 'new_page'
      || action === 'browser_tabs' && args.action !== 'list'
    if (pageChanged) {
      labels.clear()
      currentUrl = undefined
      currentPage = undefined
    }
    const nextPages = new Map<number, string>()
    let nextCurrent: number | undefined
    for (const line of text.split('\n')) {
      const tab = /^- (\d+):( \(current\))? \[.*\]\(([^\s]+)\)(?: \[crashed\])?$/u.exec(line)
      const page = /^(\d+): (.+?)( \[selected\])?(?: isolatedContext=.*)?$/u.exec(line)
      if (tab !== null) {
        const index = Number(tab[1])
        if (tab[3] === undefined) continue
        nextPages.set(index, tab[3])
        if (tab[2] !== undefined) nextCurrent = index
      } else if (page !== null) {
        const index = Number(page[1])
        if (page[2] === undefined) continue
        const url = /\(([^\s]+)\)$/u.exec(page[2])?.[1] ?? page[2]
        if (!/^[a-z][a-z\d+.-]*:/iu.test(url)) continue
        nextPages.set(index, url)
        if (page[3] !== undefined) nextCurrent = index
      }
    }
    if (nextPages.size > 0 || /No open tabs\./u.test(text)) {
      if (nextCurrent !== currentPage) labels.clear()
      pages = nextPages
      currentPage = nextCurrent
      currentUrl = nextCurrent === undefined ? undefined : pages.get(nextCurrent)
    }
    const url = /(?:Page URL|URL):\s*([a-z][a-z\d+.-]*:\S+)/iu.exec(text)?.[1]
      ?? /^\s*uid=[\w-]+ RootWebArea[^\n]*\burl="([^"]+)"/mu.exec(text)?.[1]
    const requestedPage = typeof args.pageId === 'number' ? args.pageId : currentPage
    if (url !== undefined) {
      if (requestedPage !== undefined) pages.set(requestedPage, url)
      if (args.pageId === undefined || args.pageId === currentPage) {
        if (currentUrl !== url) labels.clear()
        currentUrl = url
      }
    }
    if (/### (?:Snapshot|Page state)|Page Snapshot:|## Latest page snapshot/u.test(text) || nextLabels.size > 0) {
      labels = nextLabels
      labelsPage = requestedPage
    }
    const observedUrl = url ?? (typeof args.pageId === 'number' ? pages.get(args.pageId) : currentUrl)
    if (approvedHost !== undefined && observedUrl !== undefined && new URL(observedUrl).hostname.toLowerCase() === approvedHost) {
      approvedHosts.add(approvedHost)
    }
  })
}
