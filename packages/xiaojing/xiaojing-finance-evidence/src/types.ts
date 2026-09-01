/** Public request and evidence types for Xiaojing's official finance-tax research service. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identifier for one configured official-source family. */
export type FinanceEvidenceSourceId = Branded<'FinanceEvidenceSourceId'>

/**
 * Brand a configured official-source identifier.
 * @param value - Registry identifier.
 * @returns Branded identifier.
 */
export function FinanceEvidenceSourceId(value: string): FinanceEvidenceSourceId {
  return value as FinanceEvidenceSourceId
}

/** Legal-authority tier used by the Finance evidence baseline. */
export type FinanceEvidenceAuthorityLevel = 'L0' | 'L1' | 'L2' | 'L3'

/** Legal effect inferred from an official document's own title and text. */
export type FinanceEvidenceLegalEffect =
  | 'law'
  | 'administrative-regulation'
  | 'departmental-rule'
  | 'normative-document'
  | 'official-guidance'
  | 'unknown'

/** Document status relative to the requested as-of date. */
export type FinanceEvidenceLifecycle =
  | 'current'
  | 'historical'
  | 'future'
  | 'repealed'
  | 'draft'
  | 'amended'
  | 'transitional'
  | 'unverified'

/** How the evidence may apply to the user's facts. */
export type FinanceEvidenceApplicability =
  | 'national-conditional'
  | 'local-conditional'
  | 'background-only'
  | 'unverified'

/** Whether the service fetched official text or only found a search result. */
export type FinanceEvidenceRole = 'official-text' | 'discovery-only'

/** One official-source research request. */
export interface FinanceEvidenceRequest {
  /** Tax, accounting, invoice, or finance-policy question to research. */
  query: string
  /** Rule-evaluation date in `YYYY-MM-DD`; omission uses the current Beijing date. */
  asOfDate?: string
  /** Mainland province, municipality, or more specific locality. */
  locality?: string
}

/** One attributable official result or discovery lead. */
export interface FinanceEvidenceItem {
  /** Configured official-source family. */
  sourceId: FinanceEvidenceSourceId
  /** Human-readable issuing source. */
  authority: string
  /** Legal-authority tier. */
  authorityLevel: FinanceEvidenceAuthorityLevel
  /** Official document title. */
  title: string
  /** Document number when the fetched page exposes one. */
  documentNumber?: string
  /** Publication date in `YYYY-MM-DD`. */
  publicationDate?: string
  /** First effective date in `YYYY-MM-DD`. */
  effectiveFrom?: string
  /** Last effective date in `YYYY-MM-DD`. */
  effectiveTo?: string
  /** Status relative to the request's as-of date. */
  lifecycle: FinanceEvidenceLifecycle
  /** Legal effect inferred from the document. */
  legalEffect: FinanceEvidenceLegalEffect
  /** Applicability classification; it never substitutes for client facts. */
  applicability: FinanceEvidenceApplicability
  /** Whether official text was fetched or the item remains a discovery lead. */
  role: FinanceEvidenceRole
  /** Direct official HTTPS URL. */
  url: string
  /** Time the official page was fetched; absent for a discovery-only result. */
  retrievedAt?: string
  /** SHA-256 of the fetched response body. */
  sha256?: string
  /** Bounded excerpt derived only from fetched official text. */
  excerpt?: string
  /** Whether this response used the local bounded cache. */
  retrieval: 'network' | 'cache' | 'not-fetched'
  /** Rights are not assumed from public availability. */
  rightsStatus: 'terms-review-pending'
  /** Reasons the item cannot independently support a definitive conclusion. */
  limitations: string[]
}

/** Result status for one official-source research pass. */
export type FinanceEvidenceStatus = 'verified' | 'partial' | 'pending' | 'out-of-scope'

/** Auditable result returned to the Finance agent and persisted in `tool/result`. */
export interface FinanceEvidenceResult {
  /** Evidence availability, not a legal conclusion. */
  status: FinanceEvidenceStatus
  /** Normalized research question. */
  query: string
  /** Date against which lifecycle was evaluated. */
  asOfDate: string
  /** Supported legal jurisdiction. */
  jurisdiction: '中国大陆'
  /** Locality used for discovery, when supplied directly or by client context. */
  locality?: string
  /** Origin of the locality selection. */
  localitySource: 'request' | 'client' | 'none'
  /** Completion timestamp for this research pass. */
  checkedAt: string
  /** Official-source evidence and unresolved discovery leads. */
  evidence: FinanceEvidenceItem[]
  /** Explicit assumptions made by the service. */
  assumptions: string[]
  /** Missing, conflicting, or unverified evidence conditions. */
  warnings: string[]
}
