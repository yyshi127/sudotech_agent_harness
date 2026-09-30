import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, Type, load } from 'js-yaml'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'packages', 'client', 'xiaojing-product', 'product.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

const expectedBaseline = {
  remote: 'https://github.com/deepseek-ai/deepseek-harness.git',
  release: 'dsh-v0.2.0-rc.2',
}
if (manifest.schemaVersion !== 1
  || JSON.stringify(manifest.upstream) !== JSON.stringify(expectedBaseline)) {
  throw new Error('xiaojing product upstream baseline changed without an explicit manifest update')
}

const coreRoots = [
  'packages/client/ui-sidebar/src',
  'packages/client/ui-chat/src',
  'packages/client/ui-conversation/src',
  'packages/client/ui-settings-models/src',
  'packages/client/ui-settings/src',
  'packages/client/ui-agent-preset/src',
  'packages/client/ui-theme/src',
  'packages/client/ui-renderer/src',
  'packages/client/web/src',
]
const productMarks = /小兢|数豆|SUDO|sdoobot|sudo-logo|xiaojing-product|Finance模式/i
const errors = []
const expectedFinancePreset = {
  id: 'finance',
  name: 'Finance模式',
  base: 'standard',
  composition: 'apps/cli/config/xiaojing-agent-presets/finance/agent.cordis.yml',
}
if (JSON.stringify(manifest.agentPresets) !== JSON.stringify([expectedFinancePreset])) {
  errors.push('xiaojing product manifest does not own the expected Finance模式 preset')
}
const expectedFinanceRules = {
  schemaVersion: 1,
  presetRoot: 'apps/cli/config/xiaojing-agent-presets',
  durableRoot: 'harness/finance',
  compatibilityAdapter: 'src/compat.ts',
  skills: [
    {
      name: 'finance-tax-research-cn',
      path: 'apps/cli/config/xiaojing-agent-presets/finance/skills/finance-tax-research-cn/SKILL.md',
    },
    {
      name: 'finance-document-reading',
      path: 'apps/cli/config/xiaojing-agent-presets/finance/skills/finance-document-reading/SKILL.md',
    },
    {
      name: 'finance-invoice-review',
      path: 'apps/cli/config/xiaojing-agent-presets/finance/skills/finance-invoice-review/SKILL.md',
    },
    {
      name: 'finance-voucher-draft',
      path: 'apps/cli/config/xiaojing-agent-presets/finance/skills/finance-voucher-draft/SKILL.md',
    },
    {
      name: 'finance-data-analysis',
      path: 'apps/cli/config/xiaojing-agent-presets/finance/skills/finance-data-analysis/SKILL.md',
    },
  ],
  host: {
    directory: 'packages/xiaojing',
    packagePrefix: '@deepseek-ai/dsh-xiaojing-finance-',
    rowPrefix: 'xiaojing-finance-',
  },
  client: {
    directory: 'packages/client',
    packagePrefix: '@deepseek-ai/dsh-client-ui-xiaojing-finance-',
    rowPrefix: 'ui-xiaojing-finance-',
  },
}
const financeExtension = manifest.financeExtension
const financeRules = financeExtension === undefined ? undefined : {
  schemaVersion: financeExtension.schemaVersion,
  presetRoot: financeExtension.presetRoot,
  durableRoot: financeExtension.durableRoot,
  compatibilityAdapter: financeExtension.compatibilityAdapter,
  skills: financeExtension.skills,
  host: financeExtension.host === undefined ? undefined : {
    directory: financeExtension.host.directory,
    packagePrefix: financeExtension.host.packagePrefix,
    rowPrefix: financeExtension.host.rowPrefix,
  },
  client: financeExtension.client === undefined ? undefined : {
    directory: financeExtension.client.directory,
    packagePrefix: financeExtension.client.packagePrefix,
    rowPrefix: financeExtension.client.rowPrefix,
  },
}
if (JSON.stringify(financeRules) !== JSON.stringify(expectedFinanceRules)
  || !Array.isArray(financeExtension?.host?.packages)
  || !Array.isArray(financeExtension?.client?.packages)) {
  errors.push('xiaojing Finance extension rules or package inventories are invalid')
}

const jsExpression = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: value => ({ __jsExpr: value }),
})
const entrySchema = JSON_SCHEMA.extend(jsExpression)
const standardPresetPath = join(root, 'packages', 'bundle', 'web-app', 'presets', 'standard.patch.yml')
const financePresetPath = join(root, expectedFinancePreset.composition)
const presetDeclaration = (document, id) => document
  ?.flatMap(patch => Array.isArray(patch?.insert) ? patch.insert : [])
  .find(row => row?.id === `preset-${id}`
    && row?.name === '@deepseek-ai/dsh-agent-preset'
    && row?.config?.id === id)
const standardDeclaration = presetDeclaration(
  load(await readFile(standardPresetPath, 'utf8'), { schema: entrySchema }), 'standard',
)
const financeDeclaration = presetDeclaration(
  load(await readFile(financePresetPath, 'utf8'), { schema: entrySchema }), 'finance',
)
const standardRows = standardDeclaration?.config?.plugins
const financeRows = financeDeclaration?.config?.plugins
if (!Array.isArray(standardRows) || !Array.isArray(financeRows)) {
  errors.push('standard and Finance模式 must both be declarative Agent presets with plugin lists')
} else {
  const standardCapabilities = standardRows.filter(row => row?.id !== 'persona')
  const financeCapabilities = financeRows.filter(row => row?.id !== 'persona')
  const standardSkillRow = standardCapabilities.find(row => row?.id === 'skill-filesystem')
  const financeSkillRow = financeCapabilities.find(row => row?.id === 'skill-filesystem')
  const financeSkillRoot = {
    __jsExpr: "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))",
  }
  const expectedFinanceSkillConfig = {
    ...standardSkillRow?.config,
    customSkillDirs: [
      ...(standardSkillRow?.config?.customSkillDirs ?? []),
      financeSkillRoot,
    ],
  }
  const { config: _standardSkillConfig, ...standardSkillIdentity } = standardSkillRow ?? {}
  const { config: _financeSkillConfig, ...financeSkillIdentity } = financeSkillRow ?? {}
  if (JSON.stringify(financeSkillIdentity) !== JSON.stringify(standardSkillIdentity)
    || JSON.stringify(financeSkillRow?.config) !== JSON.stringify(expectedFinanceSkillConfig)) {
    errors.push('Finance模式 must add only its product-owned skill root to the Standard skill provider')
  }
  const expectedFinanceConsumers = new Map([
    ['finance-client-context', '@deepseek-ai/dsh-xiaojing-finance-domain/context'],
    ['finance-files', '@deepseek-ai/dsh-xiaojing-finance-domain/files-tool'],
    ['finance-vouchers', '@deepseek-ai/dsh-xiaojing-finance-domain/vouchers-tool'],
    ['finance-references', '@deepseek-ai/dsh-xiaojing-finance-domain/references-tool'],
    ['finance-voucher-preparation', '@deepseek-ai/dsh-xiaojing-finance-domain/voucher-preparation-tool'],
    ['finance-voucher-deletion', '@deepseek-ai/dsh-xiaojing-finance-domain/voucher-deletion-tool'],
    ['finance-journal-deletion', '@deepseek-ai/dsh-xiaojing-finance-domain/journal-deletion-tool'],
    ['finance-open-item-deletion', '@deepseek-ai/dsh-xiaojing-finance-domain/open-item-deletion-tool'],
    ['finance-open-item-write-off', '@deepseek-ai/dsh-xiaojing-finance-domain/open-item-write-off-tool'],
    ['finance-journal-preparation', '@deepseek-ai/dsh-xiaojing-finance-domain/journal-preparation-tool'],
    ['finance-open-item-preparation', '@deepseek-ai/dsh-xiaojing-finance-domain/open-item-preparation-tool'],
    ['finance-master-data-preparation', '@deepseek-ai/dsh-xiaojing-finance-domain/master-data-preparation-tool'],
    ['finance-calculations', '@deepseek-ai/dsh-xiaojing-finance-calculations/tool'],
    ['finance-evidence', '@deepseek-ai/dsh-xiaojing-finance-evidence/tool'],
    ['finance-documents', '@deepseek-ai/dsh-xiaojing-finance-documents/tool'],
    ['finance-balances', '@deepseek-ai/dsh-xiaojing-finance-domain/balances-tool'],
    ['finance-journals', '@deepseek-ai/dsh-xiaojing-finance-domain/journals-tool'],
    ['finance-open-items', '@deepseek-ai/dsh-xiaojing-finance-domain/open-items-tool'],
    ['finance-open-item-analysis', '@deepseek-ai/dsh-xiaojing-finance-domain/open-item-analysis-tool'],
  ])
  for (const [id, name] of expectedFinanceConsumers) {
    const rows = financeCapabilities.filter(row => row?.id === id)
    if (rows.length !== 1 || rows[0]?.name !== name) {
      errors.push(`Finance模式 must load exactly one ${id} consumer from ${name}`)
    }
  }
  const normalizedFinanceCapabilities = financeCapabilities.map(row => (
    row?.id === 'skill-filesystem' ? standardSkillRow : row
  )).filter(row => !expectedFinanceConsumers.has(row?.id))
  if (JSON.stringify(normalizedFinanceCapabilities) !== JSON.stringify(standardCapabilities)) {
    errors.push('Finance模式 capabilities drifted from Standard mode outside its product skill root')
  }
  const personas = financeRows.filter(row => row?.id === 'persona')
  const financePersona = personas[0]
  if (personas.length !== 1
    || financePersona?.name !== '@deepseek-ai/dsh-persona'
    || typeof financePersona?.config?.prefix !== 'string'
    || !financePersona.config.prefix.includes('Finance模式')
    || !financePersona.config.prefix.includes('待核验')
    || !financePersona.config.prefix.includes('finance_document')) {
    errors.push('Finance模式 must own one finance-specific, verification-aware persona row')
  }
}
for (const skill of financeExtension?.skills ?? []) {
  if (typeof skill?.name !== 'string'
    || typeof skill?.path !== 'string'
    || !skill.path.startsWith(`${expectedFinanceRules.presetRoot}/finance/skills/`)) {
    errors.push('Finance skill inventory contains an invalid product-owned entry')
    continue
  }
  const source = await readFile(join(root, skill.path), 'utf8')
  if (!source.startsWith(`---\nname: ${skill.name}\n`)) {
    errors.push(`Finance skill ${skill.name} has invalid metadata`)
  } else if (skill.name === 'finance-tax-research-cn'
    && (!source.includes('fgk.chinatax.gov.cn')
      || !source.includes('flk.npc.gov.cn')
      || !source.includes('待核验'))) {
    errors.push('Finance official-research skill is missing its verification rules')
  } else if (skill.name === 'finance-document-reading'
    && (!source.includes('finance_document')
      || !source.includes('vision-required')
      || !source.includes('Do not use shell'))) {
    errors.push('Finance document-reading skill is missing its deterministic reading rules')
  }
}
if (financeDeclaration?.config?.name !== 'Finance模式'
  || financeDeclaration?.config?.order !== 5
  || typeof financeDeclaration?.config?.description !== 'string') {
  errors.push('Finance模式 declaration must keep its product name, fifth position, and description')
}
const directoryIds = async (directory) => (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const officialPresetIds = (await readdir(join(root, 'packages', 'bundle', 'web-app', 'presets')))
  .filter(name => name.endsWith('.patch.yml'))
  .map(name => name.slice(0, -'.patch.yml'.length))
  .sort()
const productPresetIds = await directoryIds(join(root, expectedFinanceRules.presetRoot))
if (JSON.stringify(officialPresetIds) !== JSON.stringify(['cordis', 'minimal', 'ptc', 'standard'])) {
  errors.push('official Agent-preset root must contain only the four upstream presets')
}
if (JSON.stringify(productPresetIds) !== JSON.stringify(manifest.agentPresets.map(value => value.id).sort())) {
  errors.push('Xiaojing Agent-preset root does not match the product manifest')
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (/\.(?:css|ts|tsx)$/.test(entry.name)) files.push(path)
  }
  return files
}

async function packageManifests(directory) {
  const manifests = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packageDirectory = join(directory, entry.name)
    try {
      const value = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
      if (typeof value.name === 'string') manifests.push({ name: value.name, directory: packageDirectory })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      // A source grouping directory without package.json is not an npm package.
    }
  }
  return manifests
}

function nestedRows(entries, rows = []) {
  if (!Array.isArray(entries)) return rows
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    rows.push(entry)
    if (Array.isArray(entry.config)) nestedRows(entry.config, rows)
    if (Array.isArray(entry.insert)) nestedRows(entry.insert, rows)
  }
  return rows
}

for (const directory of coreRoots) {
  for (const file of await sourceFiles(join(root, directory))) {
    const source = await readFile(file, 'utf8')
    if (productMarks.test(source)) errors.push(relative(root, file).replaceAll('\\', '/'))
  }
}

const composition = await readFile(join(root, 'packages', 'bundle', 'web-app', 'cordis.patch.yml'), 'utf8')
const parsedComposition = load(composition, { schema: entrySchema })
const compositionRows = nestedRows(parsedComposition)
const webAppManifest = JSON.parse(await readFile(join(root, 'packages', 'bundle', 'web-app', 'package.json'), 'utf8'))
const financeCalculationsHostRow = compositionRows.find(row => row.id === 'xiaojing-finance-calculations')
if (financeCalculationsHostRow?.name !== '@deepseek-ai/dsh-xiaojing-finance-calculations'
  || financeCalculationsHostRow?.disabled?.__jsExpr !== "process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'") {
  errors.push('Finance deterministic-calculation Host must be isolated to the Xiaojing build profile')
}
const financeEvidenceHostRow = compositionRows.find(row => row.id === 'xiaojing-finance-evidence')
if (financeEvidenceHostRow?.name !== '@deepseek-ai/dsh-xiaojing-finance-evidence'
  || financeEvidenceHostRow?.disabled?.__jsExpr !== "process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'") {
  errors.push('Finance official-evidence Host must be isolated to the Xiaojing build profile')
}
const financeDocumentsHostRow = compositionRows.find(row => row.id === 'xiaojing-finance-documents')
if (financeDocumentsHostRow?.name !== '@deepseek-ai/dsh-xiaojing-finance-documents'
  || financeDocumentsHostRow?.disabled?.__jsExpr !== "process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'") {
  errors.push('Finance document-normalization Host must be isolated to the Xiaojing build profile')
}
for (const path of [...manifest.assets, ...manifest.desktopManifests]) {
  await readFile(join(root, path))
}
for (const slot of manifest.slots) {
  const declarationRoots = coreRoots.filter(directory => directory !== 'packages/client/ui-theme/src')
  const found = await Promise.all(declarationRoots.map(async directory => {
    const files = await sourceFiles(join(root, directory))
    return (await Promise.all(files.map(file => readFile(file, 'utf8')))).some(text => text.includes(`'${slot}'`))
  }))
  if (!found.some(Boolean)) errors.push(`missing generic slot declaration: ${slot}`)
}
if (!composition.includes("name: '@deepseek-ai/dsh-client-xiaojing-product'")) {
  errors.push('web-app composition does not load @deepseek-ai/dsh-client-xiaojing-product')
}
for (const capability of manifest.featurePackages) {
  if (!composition.includes(`name: '${capability}'`)) {
    errors.push(`web-app composition does not load ${capability}`)
  }
  if (webAppManifest.dependencies?.[capability] === undefined) {
    errors.push(`web-app resolver manifest does not depend on ${capability}`)
  }
}
for (const [planeName, plane] of [['host', financeExtension?.host], ['client', financeExtension?.client]]) {
  if (plane === undefined || !Array.isArray(plane.packages)) continue
  const manifests = await packageManifests(join(root, plane.directory))
  const packageDirectories = new Map(manifests.map(value => [value.name, value.directory]))
  const discoveredPackages = manifests
    .map(value => value.name)
    .filter(name => name.startsWith(plane.packagePrefix))
    .sort()
  const declaredPackages = plane.packages
    .map(value => value?.name)
    .filter(name => typeof name === 'string')
    .sort()
  if (JSON.stringify(discoveredPackages) !== JSON.stringify(declaredPackages)) {
    errors.push(`Finance ${planeName} package inventory does not match product-owned source packages`)
  }
  const discoveredRows = compositionRows
    .filter(row => typeof row.id === 'string' && row.id.startsWith(plane.rowPrefix))
    .map(row => row.id)
    .sort()
  const declaredRows = plane.packages
    .map(value => value?.row)
    .filter(row => typeof row === 'string')
    .sort()
  if (JSON.stringify(discoveredRows) !== JSON.stringify(declaredRows)) {
    errors.push(`Finance ${planeName} composition rows do not match the product manifest`)
  }
  for (const entry of plane.packages) {
    if (typeof entry?.name !== 'string'
      || typeof entry?.row !== 'string'
      || typeof entry?.compatibilityAdapter !== 'boolean') {
      errors.push(`Finance ${planeName} package entries need name, row, and compatibilityAdapter fields`)
      continue
    }
    const suffix = entry.name.startsWith(plane.packagePrefix)
      ? entry.name.slice(plane.packagePrefix.length)
      : ''
    if (suffix === '' || entry.row !== `${plane.rowPrefix}${suffix}`) {
      errors.push(`Finance ${planeName} package ${entry.name} does not follow the package-to-row naming rule`)
    }
    const row = compositionRows.find(candidate => candidate.id === entry.row)
    if (row?.name !== entry.name) {
      errors.push(`Finance ${planeName} row ${entry.row} does not load ${entry.name}`)
    }
    if (entry.compatibilityAdapter) {
      const directory = packageDirectories.get(entry.name)
      if (directory === undefined) {
        errors.push(`Finance ${planeName} package ${entry.name} has no source directory`)
      } else {
        try {
          await readFile(join(directory, financeExtension.compatibilityAdapter))
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
          errors.push(`Finance ${planeName} package ${entry.name} is missing ${financeExtension.compatibilityAdapter}`)
        }
      }
    }
  }
}
const productClient = await readFile(join(root, 'packages', 'client', 'xiaojing-product', 'src', 'client', 'index.ts'), 'utf8')
if (!productClient.includes("process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'")) {
  errors.push('xiaojing product client is not gated by the xiaojing build profile')
}
if (!productClient.includes("id: 'about-xiaojing'") || !productClient.includes('order: 1010')) {
  errors.push('Xiaojing About settings are missing or no longer follow desktop-companion settings')
}
const productRelease = await readFile(join(
  root, 'packages', 'client', 'xiaojing-product', 'src', 'client', 'application-info.ts',
), 'utf8')
const desktopIdentity = JSON.parse(await readFile(join(root, 'apps', 'desktop', 'identity.json'), 'utf8'))
if (!productRelease.includes(`export const XIAOJING_PRODUCT_VERSION = '${desktopIdentity.productVersion}'`)) {
  errors.push('Xiaojing Web fallback version does not match the desktop application version')
}
const weixinClient = await readFile(join(root, 'packages', 'client', 'ui-weixin-channel', 'src', 'client', 'index.ts'), 'utf8')
if (!weixinClient.includes("process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'")
  || !weixinClient.includes('connection.isLoopback')) {
  errors.push('Weixin channel client is not gated by the xiaojing build profile and loopback origin')
}
const companionClient = await readFile(join(
  root, 'packages', 'client', 'ui-desktop-companion', 'src', 'client', 'index.ts',
), 'utf8')
if (!companionClient.includes("process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'")
  || !companionClient.includes("id: 'desktop-companion'")
  || !companionClient.includes('order: 1000')) {
  errors.push('desktop-companion settings are not isolated to the Xiaojing profile and expected settings position')
}
const browserControlClient = await readFile(join(
  root, 'packages', 'client', 'ui-xiaojing-browser-control', 'src', 'client', 'index.ts',
), 'utf8')
if (!browserControlClient.includes("process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'")
  || !browserControlClient.includes('connection.isLoopback')
  || !browserControlClient.includes("id: 'browser-control'")) {
  errors.push('browser-control settings are not isolated to a standalone Xiaojing loopback section')
}
const usageAccountingClient = await readFile(join(
  root, 'packages', 'client', 'ui-usage-accounting', 'src', 'client', 'index.ts',
), 'utf8')
if (!usageAccountingClient.includes("process.env.DSH_CLIENT_BUILD_PROFILE !== 'xiaojing'")) {
  errors.push('usage-accounting UI is not gated by the xiaojing build profile')
}
const userDataContract = JSON.parse(await readFile(join(root, 'apps', 'desktop', 'user-data-contract.json'), 'utf8'))
if (!userDataContract.protectedPaths.includes('harness/weixin-channel')) {
  errors.push('Weixin channel durable state is missing from the desktop user-data contract')
}
if (!userDataContract.protectedPaths.includes('desktop-companion')) {
  errors.push('desktop-companion preferences are missing from the desktop user-data contract')
}
if (!userDataContract.protectedPaths.includes(financeExtension?.durableRoot)) {
  errors.push('Finance durable state is missing from the desktop user-data contract')
}
const desktopMain = await readFile(join(root, 'apps', 'desktop', 'src', 'main.ts'), 'utf8')
const desktopCompanion = await readFile(join(root, 'apps', 'desktop', 'src', 'xiaojing-companion.ts'), 'utf8')
if (!desktopMain.includes("window.on('close'")
  || !desktopMain.includes('backgroundNotice.close(hide)')
  || !desktopMain.includes('quitConfirmation.confirm()')
  || !desktopMain.includes('quitApplication: () => { app.quit() }')
  || !desktopCompanion.includes("label: '退出小兢会计', click: () => { void this.requestQuit() }")
  || !desktopMain.includes("app.on('window-all-closed'")
  || !desktopCompanion.includes("new URL('/xiaojing-desktop-companion/events', hostUrl)")) {
  errors.push('desktop tray lifecycle no longer keeps close, tray exit, and window-all-closed behavior explicit')
}
const buildEnvironment = await readFile(join(root, 'scripts', 'client-build-environment.ts'), 'utf8')
if (!buildEnvironment.includes("DSH_CLIENT_BUILD_PROFILE: 'xiaojing'")) {
  errors.push('xiaojing client build profile is missing')
}
const rootManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const desktopManifest = JSON.parse(await readFile(join(root, 'apps', 'desktop', 'package.json'), 'utf8'))
const desktopPackageTarget = await readFile(join(root, 'apps', 'desktop', 'scripts', 'package-target.ts'), 'utf8')
const desktopBuilder = await readFile(join(root, 'apps', 'desktop', 'scripts', 'electron-builder-config.mjs'), 'utf8')
if (rootManifest.scripts?.['build:xiaojing'] !== 'tsx scripts/build.ts --profile xiaojing'
  || rootManifest.scripts?.['desktop:dist'] !== 'pnpm run package:desktop:win:x64'
  || rootManifest.scripts?.['package:desktop:win:x64'] !== 'pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64'
  || desktopManifest.name !== '@deepseek-ai/dsh-desktop'
  || desktopManifest.main !== 'lib/main.js'
  || !desktopPackageTarget.includes("await execute(['run', 'build:xiaojing']")
  || desktopPackageTarget.includes("await execute(['run', 'build:official']")
  || !desktopBuilder.includes("'lib/main.js'")) {
  errors.push('the desktop release path no longer selects the xiaojing client profile')
}

if (errors.length > 0) {
  throw new Error(`xiaojing product isolation failed:\n${errors.map(error => `- ${error}`).join('\n')}`)
}
console.log(`xiaojing product layer verified against upstream ${manifest.upstream.release}`)
