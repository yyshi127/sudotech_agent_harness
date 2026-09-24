/** Optional handoff from the shared local-file picker to Finance client storage. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** File metadata returned by the local upload service. */
export interface LocalUploadedFile {
  /** Browser-visible filename. */
  name: string
  /** Absolute Host path in the upload service directory. */
  path: string
  /** Stored byte length. */
  size: number
  /** Upload-service timestamp. */
  modifiedAt: string
}

/** Lazy upload request that lets non-Finance sessions preserve the existing path. */
export interface FinanceLocalFilePrepareRequest {
  /** Session receiving the selected file. */
  sessionId: SessionId
  /** Original browser filename used for the client-owned copy. */
  originalName: string
  /** Upload the bytes once when a Finance listener claims the request. */
  upload: () => Promise<LocalUploadedFile>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Let a product Finance client session replace one local upload with its controlled client copy.
     * @mode serial
     * @param request - Session identity, original filename, and lazy upload callback.
     * @returns Replacement metadata, or undefined without uploading when Finance does not own the session.
     */
    'xiaojing-finance/local-file-prepare': (
      request: FinanceLocalFilePrepareRequest,
    ) => Promise<LocalUploadedFile | undefined> | LocalUploadedFile | undefined
  }
}
