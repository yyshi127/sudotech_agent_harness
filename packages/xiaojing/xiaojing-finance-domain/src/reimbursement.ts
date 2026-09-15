/** Reimbursement-only credentials and documented API transport; never uses the finance AppSecret. */
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import type { FinanceClientId, ReimbursementConnectionView, SaveReimbursementConnectionRequest } from './types.ts'

const apiUrl = z.enum(['https://yiqbdata.superboss.cc', 'https://yiqbdatatest.superboss.cc'])
const keyText = z.string().trim().regex(/^[A-Za-z0-9_-]{8,200}$/u)
const storedSchema = z.object({ revision: z.number().int().positive(), apiUrl, appKey: keyText, appSecret: keyText }).strict()
const saveSchema = z.object({
  clientId: z.uuid(), expectedRevision: z.number().int().nonnegative(), apiUrl, appKey: keyText, appSecret: keyText.optional(),
}).strict()
type Stored = z.infer<typeof storedSchema>
const recordKey = (id: FinanceClientId) => credentialKey('xiaojing-finance-domain', `reimbursement-${id}`)

function decode(record: CredentialRecord | undefined): Stored | undefined {
  if (record === undefined) return undefined
  try { return storedSchema.parse(JSON.parse(record.kind === 'api-key' ? record.key ?? '' : '')) }
  catch { throw new Error('报销连接配置损坏，请重新配置；财务连接不受影响。') }
}

/** Documented operations, with no arbitrary URL supplied by a tool. */
export const reimbursementPaths = {
  templates: '/reimburse/base/getTemplateTree.rjson',
  users: '/reimburse/user/getUserList.rjson',
  departments: '/reimburse/dept/getDeptList.rjson',
  payees: '/reimburse/base/getBankCardInfoList.rjson',
  create: '/reimburse/order/createOrder.rjson',
  result: '/reimburse/order/getPushResult.rjson',
  status: '/reimburse/order/getOrderStatusList.rjson',
} as const

/** Authenticated operation-local transport. Its token and signed attachment URLs must never enter tool results. */
export interface ReimbursementApi {
  revision: number
  /** @param operation - Documented operation. @param body - Validated fields. @returns Untrusted vendor data. */
  call(operation: keyof typeof reimbursementPaths, body: object): Promise<unknown>
}

/** Bounded transport defaults supplied by Host composition. */
export interface ReimbursementOptions { apiUrl: string; timeoutMs: number; maxResponseBytes: number }

/** Per-account reimbursement credential storage and operation-local authorization. */
export class ReimbursementConnection {
  /** @param credentials - Private Host storage. @param options - Deployment defaults and response limits. */
  constructor(private readonly credentials: CredentialProvider, private readonly options: ReimbursementOptions) {
    apiUrl.parse(options.apiUrl)
  }

  /**
   * Read independent reimbursement configuration without secrets.
   * @param id - Selected account-book.
   * @param defaultAppKey - Existing finance AppKey, never its secret.
   * @returns Safe settings.
   */
  async read(id: FinanceClientId, defaultAppKey: string): Promise<ReimbursementConnectionView> {
    const saved = decode(await this.credentials.readRecord(recordKey(id)))
    return { revision: saved?.revision ?? 0, apiUrl: saved?.apiUrl ?? this.options.apiUrl,
      appKey: saved?.appKey ?? defaultAppKey, configured: saved !== undefined,
      writable: (await this.credentials.describeRecord(recordKey(id))).writable }
  }

  /**
   * Save reimbursement credentials with an independent revision.
   * @param request - Revision-checked credential replacement.
   * @returns Saved settings without the AppSecret.
   */
  async save(request: SaveReimbursementConnectionRequest): Promise<ReimbursementConnectionView> {
    const parsed = saveSchema.safeParse(request)
    if (!parsed.success) throw new Error('报销连接字段无效，请检查接口地址和 Key。')
    const input = parsed.data
    await this.credentials.modifyRecord(recordKey(request.clientId), (record) => {
      const saved = decode(record)
      if ((saved?.revision ?? 0) !== input.expectedRevision) throw new Error('报销配置已变更，请重新加载。')
      if (input.appSecret === undefined && (saved === undefined || saved.appKey !== input.appKey || saved.apiUrl !== input.apiUrl)) {
        throw new Error('首次配置或更换地址、AppKey 时，请填写配套的报销 AppSecret。')
      }
      const appSecret = input.appSecret ?? saved?.appSecret
      if (appSecret === undefined) throw new Error('请填写报销 AppSecret。')
      const next = { revision: input.expectedRevision + 1, apiUrl: input.apiUrl, appKey: input.appKey, appSecret }
      return Promise.resolve({ kind: 'api-key', key: JSON.stringify(next) })
    })
    return this.read(request.clientId, request.appKey)
  }

  /**
   * Authenticate a snapshot of saved reimbursement credentials.
   * @param id - Host-resolved account-book.
   * @param signal - Caller/Host cancellation.
   * @returns Snapshot-scoped API, not a model tool.
   */
  async connect(id: FinanceClientId, signal: AbortSignal): Promise<ReimbursementApi> {
    const saved = decode(await this.credentials.readRecord(recordKey(id)))
    if (!saved) throw new Error('请先在帐套信息中配置有成报销连接；财务绿点不代表报销已配置。')
    let token = ''
    const request = async (path: string, body: object, authenticated: boolean): Promise<unknown> => {
      const url = new URL(path, saved.apiUrl)
      if (authenticated) { url.searchParams.set('appKey', saved.appKey); url.searchParams.set('accessToken', token) }
      let result: unknown
      try {
        const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]) })
        if (!response.ok) { await response.body?.cancel(); throw new Error() }
        const reader = response.body?.getReader()
        if (!reader) throw new Error()
        const chunks: Uint8Array[] = []
        let size = 0
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            size += chunk.value.byteLength
            if (size > this.options.maxResponseBytes) throw new Error()
            chunks.push(chunk.value)
          }
        } finally { await reader.cancel() }
        result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch { throw new Error('有成报销请求未完成（网络、超时、取消或响应异常）；写入结果需回查，不能直接重复创建。') }
      const envelope = z.object({ result: z.number(), message: z.string().optional(), data: z.unknown().optional() }).safeParse(result)
      if (!envelope.success) throw new Error('有成报销返回的数据格式异常。')
      if (envelope.data.result !== 100) {
        let message = envelope.data.message ?? '请求失败'
        for (const secret of [saved.appKey, saved.appSecret, token].filter(Boolean)) message = message.split(secret).join('[已隐藏]')
        message = message.replace(/https?:\/\/[^\s"<>]+/gu, '[链接已隐藏]').slice(0, 400)
        throw new Error(`有成报销 ${envelope.data.result}：${message}`)
      }
      return envelope.data.data
    }
    const authenticated = z.object({ accessToken: z.string().min(1) }).safeParse(await request('/auth/getAccessToken.rjson', { appKey: saved.appKey, appSecret: saved.appSecret }, false))
    if (!authenticated.success) throw new Error('报销鉴权未返回有效 accessToken。')
    token = authenticated.data.accessToken
    return { revision: saved.revision, call: (operation, body) => request(reimbursementPaths[operation], body, true) }
  }
}
