/** Xiaojing product release history shown in the About settings section. */

import type { XiaojingProductKey } from './locales.ts'

interface ReleaseFeature {
  readonly label: string
  readonly copyKey: XiaojingProductKey
}

interface ProductRelease {
  readonly version: string
  readonly features: readonly ReleaseFeature[]
}

/**
 * Product releases in newest-first order.
 *
 * A new release is prepended. Existing entries remain unchanged so the About
 * page continues to distinguish each release's incremental features.
 */
export const XIAOJING_RELEASE_HISTORY = [
  {
    version: '0.3.1',
    features: [
      { label: '底座', copyKey: 'featureHarnessPlugins' },
      { label: '文件', copyKey: 'featureHarnessChanges' },
      { label: '预览', copyKey: 'featureHarnessOfficePreview' },
      { label: '模型', copyKey: 'featureFlash41' },
    ],
  },
  {
    version: '0.2.4',
    features: [
      { label: 'F2', copyKey: 'featureFinanceYouchengCore' },
      { label: 'F3', copyKey: 'featureFinanceYouchengMaintenance' },
      { label: 'F4', copyKey: 'featureFinanceCapabilityInventory' },
      { label: 'UI', copyKey: 'featureFinanceWorkspaceIdentity' },
    ],
  },
  {
    version: '0.2.3',
    features: [
      { label: 'F1-0', copyKey: 'featureFinanceFoundation' },
      { label: 'F1-1', copyKey: 'featureFinancePreset' },
      { label: 'F1-2', copyKey: 'featureFinanceClients' },
      { label: 'F1-3', copyKey: 'featureFinanceEvidence' },
      { label: 'F1-4', copyKey: 'featureFinanceDocuments' },
      { label: 'F1-5', copyKey: 'featureFinanceSkills' },
      { label: 'F1-6', copyKey: 'featureFinanceAcceptance' },
    ],
  },
  {
    version: '0.2.2',
    features: [
      { label: '01', copyKey: 'featureVision' },
      { label: '02', copyKey: 'featureWeixin' },
      { label: '03', copyKey: 'featureEdge' },
      { label: '04', copyKey: 'featureUsage' },
      { label: '05', copyKey: 'featureVisualize' },
      { label: '06', copyKey: 'featureCompanion' },
    ],
  },
] as const satisfies readonly ProductRelease[]
