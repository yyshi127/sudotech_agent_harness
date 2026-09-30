/** Non-secret authentication facts selected for one API-key request. */

/** Endpoint and key fingerprint captured from the actual request credentials. */
export interface DeepSeekRequestIdentity {
  /** Messages endpoint selected for this request. */
  baseURL: string
  /** SHA-256 fingerprint; never contains credential material. */
  authentication: { kind: 'api-key'; keyFingerprint: string }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Reports the endpoint and non-secret authentication identity selected for a DeepSeek API-key request.
     * @param identity - facts captured when resolving the request authentication.
     * @mode emit
     */
    'llm-deepseek/request-identity'(identity: DeepSeekRequestIdentity): void
  }
}
