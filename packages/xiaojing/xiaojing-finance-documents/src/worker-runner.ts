/** Host-side lifecycle for one isolated Xiaojing document parser. */

import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { WorkerOptions } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { parseWorkerMessage } from './schema.ts'
import type { FinanceDocumentWorkerMessage, FinanceDocumentWorkerRequest } from './types.ts'

/** Parser worker terminal failure. */
export class FinanceDocumentWorkerError extends Error {
  /** @param code - Stable failure code. */
  constructor(readonly code: string) {
    super(`xiaojing-finance-documents: parser worker failed (${code})`)
  }
}

function workerEnvironment(platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  if (platform !== 'win32') return {}
  const temp = tmpdir()
  return { TMP: temp, TEMP: temp }
}

function resolveWorker(request: FinanceDocumentWorkerRequest): { entry: string | URL; options: WorkerOptions } {
  if (!import.meta.url.endsWith('.ts')) {
    return {
      entry: fileURLToPath(new URL('./parser-worker.js', import.meta.url)),
      options: { workerData: request, env: workerEnvironment(), execArgv: [] },
    }
  }
  const workerEntry = new URL('./parser-worker.ts', import.meta.url)
  const tsxEsmApiEntry = import.meta.resolve('tsx/esm/api')
  const tsxCjsApiEntry = import.meta.resolve('tsx/cjs/api')
  const bootstrap = [
    `import { register as registerEsm } from ${JSON.stringify(tsxEsmApiEntry)}`,
    `import { register as registerCjs } from ${JSON.stringify(tsxCjsApiEntry)}`,
    'registerCjs()',
    'registerEsm()',
    `await import(${JSON.stringify(workerEntry.href)})`,
  ].join('\n')
  return {
    entry: new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`),
    options: { workerData: request, env: workerEnvironment(), execArgv: [] },
  }
}

/**
 * Parse one file in an isolated, memory-bounded worker.
 * @param request - Valid parser request.
 * @param timeoutMs - Wall-clock deadline.
 * @param maxOldGenerationSizeMb - Worker V8 heap ceiling.
 * @param signal - Service-lifetime cancellation signal.
 * @returns Validated worker completion message.
 */
export function runFinanceDocumentWorker(
  request: FinanceDocumentWorkerRequest,
  timeoutMs: number,
  maxOldGenerationSizeMb: number,
  signal: AbortSignal,
): Promise<FinanceDocumentWorkerMessage> {
  const resolved = resolveWorker(request)
  const worker = new Worker(resolved.entry, {
    ...resolved.options,
    resourceLimits: { maxOldGenerationSizeMb },
    stdout: true,
    stderr: true,
  })
  worker.stdout.on('data', () => {})
  worker.stderr.on('data', () => {})
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (outcome: () => FinanceDocumentWorkerMessage): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      worker.removeAllListeners('message')
      worker.removeAllListeners('messageerror')
      worker.removeAllListeners('error')
      worker.removeAllListeners('exit')
      void worker.terminate().then(() => {
        try {
          resolve(outcome())
        } catch (error) {
          reject(error instanceof Error ? error : new Error('xiaojing-finance-documents: invalid worker outcome'))
        }
      }, reject)
    }
    const fail = (code: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      worker.removeAllListeners()
      void worker.terminate().then(() => { reject(new FinanceDocumentWorkerError(code)) }, reject)
    }
    const onAbort = (): void => { fail('aborted') }
    const timer = setTimeout(() => { fail('timeout') }, timeoutMs)
    timer.unref()
    worker.once('message', (value: unknown) => { finish(() => parseWorkerMessage(value)) })
    worker.once('messageerror', () => { fail('message-deserialization-failed') })
    worker.once('error', () => { fail('worker-error') })
    worker.once('exit', (code) => { if (!settled) fail(`worker-exited-${code}`) })
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}
