/** Model-facing projection for Finance results; Host records retain the complete evidence. */

const INTERNAL_FIELDS = new Set([
  'configurationDigest',
  'channel',
  'contentVerified',
  'coverage',
  'fingerprint',
  'hashMatchesBytes',
  'modified',
  'notice',
  'pageSize',
  'pagesRead',
  'preflightStage',
  'previewJson',
  'publishedXlsx',
  'sha256',
  'size',
  'sourcePreserved',
  'sourceQuery',
  'verificationOwner',
])

function project(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(project)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key, entry]) => !INTERNAL_FIELDS.has(key) && !(key === 'preview' && typeof entry === 'string'))
    .map(([key, entry]) => [key, project(entry)]))
}

/**
 * Serialize the business and continuation fields a model needs without internal audit metadata.
 * @param value - Complete Host result.
 * @returns JSON for the model-visible tool result.
 */
export function financeModelJson(value: unknown): string {
  return JSON.stringify(project(value))
}

/**
 * Convert low-level Finance failures into one user-actionable model error.
 * @param error - Error thrown by a Finance Host call.
 * @returns Original business validation errors or a generic Finance failure.
 */
export function financeModelError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const internalFailure = /invalid-response|query-failed|network(?:-failed)?|ECONN|UND_ERR|http[-_ ]?\d|\/finance\//iu
  const internalField = /\b(?:pageSize|pageNum|rawInput|sourceQuery|fingerprint|sha256)\b/iu
  if (internalFailure.test(message) || internalField.test(message)) {
    return new Error('财务操作未完成，请检查帐套连接、有成财务权限和网络后重试。')
  }
  return error instanceof Error ? error : new Error(message)
}

/**
 * Run a Finance Host call without exposing transport or validation diagnostics to the model.
 * @param operation - Finance operation owned by the Host.
 * @returns The unchanged successful result.
 */
export async function financeModelCall<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) { throw financeModelError(error) }
}
