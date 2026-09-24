/** Harness-version adapter for session-authorized Finance document imports. */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  FinanceClientBinding,
  FinanceConsultationFile,
  FinanceManagedFile,
} from '@deepseek-ai/dsh-xiaojing-finance-domain/types'
import type {} from '@deepseek-ai/dsh-xiaojing-finance-domain'

/** File fields shared by customer and general-consultation document imports. */
export type FinanceDocumentFile = FinanceManagedFile | FinanceConsultationFile

/** File facts required by the shared parser after a session adapter authorizes the source. */
export interface DocumentSourceFile {
  /** Session-local opaque identity. */
  id: string
  /** Session that durably introduced the upload. */
  sessionId: string
  /** Canonical or canonicalizable source path. */
  path: string
  /** User-facing uploaded filename. */
  name: string
  /** Lowercase SHA-256 digest over the source bytes. */
  sha256: string
  /** Exact source byte length. */
  size: number
  /** Upload time as Unix epoch milliseconds. */
  createdAt: number
}

/** One current-session source authorized by a durable adapter fact. */
export interface DocumentSource<TFile extends DocumentSourceFile = DocumentSourceFile> {
  /** Trusted directory that must contain the canonical source file. */
  sourceRoot: string
  /** Private cache namespace: client identity or consultation session identity. */
  cacheScope: string
  /** Immutable adapter-authorized upload record. */
  file: TFile
}

/** One current-session source authorized by a durable Finance import event. */
export type FinanceDocumentSource = DocumentSource<FinanceDocumentFile>

function bindingFromSession(session: Session): FinanceClientBinding | undefined {
  for (const event of session.snapshotEvents()) {
    if (event.type === 'finance/client-bound') return event.data
  }
  return undefined
}

function validFile(session: Session, file: FinanceDocumentFile): boolean {
  return file.sessionId === session.id
    && /^[a-f0-9]{64}$/u.test(file.sha256)
    && Number.isSafeInteger(file.size)
    && file.size >= 0
    && String(file.id).length > 0
    && file.name.length > 0
    && file.path.length > 0
}

function clientSource(binding: FinanceClientBinding, session: Session, file: FinanceManagedFile): FinanceDocumentSource | undefined {
  if (file.action !== 'import' || file.stage !== 'source') return undefined
  if (!validFile(session, file) || file.clientId !== binding.client.id) return undefined
  return {
    sourceRoot: join(binding.workspacePath, '02-原始资料'),
    cacheScope: String(binding.client.id),
    file: structuredClone(file),
  }
}

function consultationSource(
  uploadRoot: string,
  session: Session,
  file: FinanceConsultationFile,
): FinanceDocumentSource | undefined {
  if (!validFile(session, file)) return undefined
  return {
    sourceRoot: uploadRoot,
    cacheScope: `session:${session.id}`,
    file: structuredClone(file),
  }
}

/**
 * Convert a published import event into an authorized parser source.
 * @param ctx - Finance Host context that owns the protected upload directory.
 * @param session - Owning session.
 * @param file - Imported file record.
 * @returns Authorized source or undefined when the stream relationship is invalid.
 */
export function financeDocumentSourceFromEvent(
  ctx: Context,
  session: Session,
  file: FinanceDocumentFile,
): FinanceDocumentSource | undefined {
  if (!('clientId' in file)) {
    return consultationSource(ctx.xiaojingFinanceDomain.localUploadRoot(), session, file)
  }
  const binding = bindingFromSession(session)
  return binding === undefined ? undefined : clientSource(binding, session, file)
}

/**
 * List original-material imports visible to one Finance agent.
 * @param ctx - Finance Host context.
 * @param agent - Calling Finance agent.
 * @returns Authorized sources in import-event order.
 */
export function financeDocumentSources(ctx: Context, agent: Agent): FinanceDocumentSource[] {
  const binding = ctx.xiaojingFinanceDomain.currentClientBinding(agent)
  const sources: FinanceDocumentSource[] = []
  for (const event of agent.session.snapshotEvents()) {
    const source = event.type === 'finance/file-imported'
      ? binding === undefined ? undefined : clientSource(binding, agent.session, event.data.file)
      : event.type === 'finance/consultation-file-imported'
        ? consultationSource(ctx.xiaojingFinanceDomain.localUploadRoot(), agent.session, event.data.file)
        : undefined
    if (source !== undefined) sources.push(source)
  }
  return sources
}
