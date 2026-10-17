/** Incremental release changes and the current release's configurable capabilities. */

import type { XiaojingProductKey } from './locales.ts'

interface ReleaseFeature {
  readonly category: 'added' | 'improved' | 'fixed' | 'available'
  readonly titleKey: XiaojingProductKey
  readonly copyKey: XiaojingProductKey
}

interface ProductRelease {
  readonly version: string
  readonly summaryKey: XiaojingProductKey
  readonly noteKey?: XiaojingProductKey
  readonly features: readonly ReleaseFeature[]
}

/** Newest-first records; changes retain their introduction release, while available entries describe current capabilities. */
export const XIAOJING_RELEASE_HISTORY = [
  {
    version: '0.3.3', summaryKey: 'summary033', noteKey: 'note033',
    features: [
      { category: 'added', titleKey: 'title033Model', copyKey: 'feature033Model' },
      { category: 'added', titleKey: 'title033Search', copyKey: 'feature033Search' },
      { category: 'improved', titleKey: 'title033Plugins', copyKey: 'feature033Plugins' },
      { category: 'improved', titleKey: 'title033Automation', copyKey: 'feature033Automation' },
      { category: 'improved', titleKey: 'title033Draft', copyKey: 'feature033Draft' },
      { category: 'improved', titleKey: 'title033Reasoning', copyKey: 'feature033Reasoning' },
      { category: 'improved', titleKey: 'title033Fonts', copyKey: 'feature033Fonts' },
      { category: 'improved', titleKey: 'title033Voice', copyKey: 'feature033Voice' },
      { category: 'improved', titleKey: 'title033Collaboration', copyKey: 'feature033Collaboration' },
      { category: 'fixed', titleKey: 'title033Reliability', copyKey: 'feature033Reliability' },
      { category: 'available', titleKey: 'title033Xiaojing', copyKey: 'feature033Xiaojing' },
    ],
  },
  {
    version: '0.3.2', summaryKey: 'summary032', noteKey: 'note032',
    features: [
      { category: 'added', titleKey: 'titleNativeBrowser', copyKey: 'featureNativeBrowser' },
      { category: 'added', titleKey: 'titleSessionApproval', copyKey: 'featureSessionApproval' },
      { category: 'added', titleKey: 'titleNoApproval', copyKey: 'featureNoApproval' },
      { category: 'fixed', titleKey: 'titleChildApprovalStatus', copyKey: 'featureChildApprovalStatus' },
      { category: 'improved', titleKey: 'titleLiveJobs', copyKey: 'featureLiveJobs' },
      { category: 'improved', titleKey: 'titleTablePreview', copyKey: 'featureTablePreview' },
      { category: 'improved', titleKey: 'titleArchiveManagement', copyKey: 'featureArchiveManagement' },
      { category: 'improved', titleKey: 'titleChangeReview', copyKey: 'featureChangeReview' },
      { category: 'improved', titleKey: 'titlePluginSources', copyKey: 'featurePluginSources' },
      { category: 'improved', titleKey: 'titleShortcutSettings', copyKey: 'featureShortcutSettings' },
      { category: 'improved', titleKey: 'titleProcessSettings', copyKey: 'featureProcessSettings' },
      { category: 'fixed', titleKey: 'titleWeixinRestore', copyKey: 'featureWeixinRestore' },
      { category: 'fixed', titleKey: 'titleTaskRecovery', copyKey: 'featureTaskRecovery' },
      { category: 'fixed', titleKey: 'titleWindowsReliability', copyKey: 'featureWindowsReliability' },
      { category: 'available', titleKey: 'titleAgentTeam', copyKey: 'featureAgentTeam' },
      { category: 'available', titleKey: 'titleAutoReview', copyKey: 'featureAutoReview' },
      { category: 'available', titleKey: 'titleScheduledTasks', copyKey: 'featureScheduledTasks' },
      { category: 'available', titleKey: 'titleVoiceInput', copyKey: 'featureVoiceInput' },
      { category: 'available', titleKey: 'titleTerminalSettings', copyKey: 'featureTerminalSettings' },
      { category: 'available', titleKey: 'titleAgentLoop', copyKey: 'featureAgentLoop' },
      { category: 'available', titleKey: 'titleSubagentSettings', copyKey: 'featureSubagentSettings' },
      { category: 'available', titleKey: 'titleWebSearch', copyKey: 'featureWebSearch' },
    ],
  },
  {
    version: '0.3.1', summaryKey: 'summary031', noteKey: 'note031',
    features: [
      { category: 'added', titleKey: 'titleWorkPanel', copyKey: 'featureWorkPanel' },
      { category: 'added', titleKey: 'titleFileReview', copyKey: 'featureFileReview' },
      { category: 'added', titleKey: 'titleFileDelivery', copyKey: 'featureFileDelivery' },
      { category: 'added', titleKey: 'titleWorkspaceTerminal', copyKey: 'featureWorkspaceTerminal' },
      { category: 'added', titleKey: 'titlePluginManagement', copyKey: 'featurePluginManagement' },
      { category: 'added', titleKey: 'titleSessionManagement', copyKey: 'featureSessionManagement' },
      { category: 'added', titleKey: 'titleExternalResources', copyKey: 'featureExternalResources' },
      { category: 'improved', titleKey: 'titleFlash41', copyKey: 'featureFlash41' },
      { category: 'improved', titleKey: 'titleTaskMessages', copyKey: 'featureTaskMessages' },
      { category: 'improved', titleKey: 'titleSubagentCollaboration', copyKey: 'featureSubagentCollaboration' },
    ],
  },
  {
    version: '0.2.4', summaryKey: 'summary024',
    features: [
      { category: 'added', titleKey: 'titleYouchengQueries', copyKey: 'featureYouchengQueries' },
      { category: 'added', titleKey: 'titleYouchengMaintenance', copyKey: 'featureYouchengMaintenance' },
      { category: 'improved', titleKey: 'titleFinanceScope', copyKey: 'featureFinanceScope' },
    ],
  },
  {
    version: '0.2.3', summaryKey: 'summary023',
    features: [
      { category: 'added', titleKey: 'titleFinanceMode', copyKey: 'featureFinanceMode' },
      { category: 'added', titleKey: 'titleFinanceClients', copyKey: 'featureFinanceClients' },
      { category: 'added', titleKey: 'titleFinanceEvidence', copyKey: 'featureFinanceEvidence' },
      { category: 'added', titleKey: 'titleFinanceDocuments', copyKey: 'featureFinanceDocuments' },
      { category: 'added', titleKey: 'titleFinanceCalculations', copyKey: 'featureFinanceCalculations' },
    ],
  },
  {
    version: '0.2.2', summaryKey: 'summary022',
    features: [
      { category: 'added', titleKey: 'titleDesktopCompanion', copyKey: 'featureDesktopCompanion' },
      { category: 'added', titleKey: 'titleSystemTray', copyKey: 'featureSystemTray' },
    ],
  },
] as const satisfies readonly ProductRelease[]
