import { createHash } from 'node:crypto'
import {
  cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { EMBEDDED_PRICE_TABLE, priceUsage } from '@deepseek-ai/dsh-usage-accounting'
import { loadProfile } from '@deepseek-ai/dsh-app-boot'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = join(appRoot, '..', '..')
const fixtureVersion = '0.1.9'
const fixtureRoot = join(appRoot, 'tests', 'fixtures', fixtureVersion)
const contract = JSON.parse(await readFile(join(appRoot, 'user-data-contract.json'), 'utf8'))
const identity = JSON.parse(await readFile(join(appRoot, 'identity.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
const main = await readFile(join(appRoot, 'main.mjs'), 'utf8')
const installer = await readFile(join(appRoot, 'build', 'installer.nsh'), 'utf8')

const EXPECTED_WEB_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-file-uploads',
]
const CURRENT_KEY_REF = credentialRef('DEEPSEEK_API_KEY')
const SESSION_ID = SessionId('fixture-session')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

if (contract.schemaVersion !== 1
  || contract.electronUserData !== '%APPDATA%\\@sudotech\\xiaojing-accounting-desktop'
  || contract.harnessHome !== 'harness'
  || contract.documentsWorkspace !== '小兢会计工作区') {
  throw new Error('desktop user-data paths changed; an explicit migration and previous-version fixture are required')
}
if (JSON.stringify(identity.userDataSegments) !== JSON.stringify(['@sudotech', 'xiaojing-accounting-desktop'])) {
  throw new Error('desktop identity no longer resolves the protected Electron user-data root')
}
if (manifest.build?.nsis?.deleteAppDataOnUninstall !== false) {
  throw new Error('the installer must retain application data on uninstall and in-place update')
}
if (!main.includes("app.setPath('userData', join(app.getPath('appData'), ...identity.userDataSegments))")
  || !main.includes("join(app.getPath('userData'), 'harness')")
  || !main.includes("join(app.getPath('documents'), '小兢会计工作区')")) {
  throw new Error('desktop startup no longer uses the permanent user-data paths')
}
if (/APPDATA|Local Storage|\.credentials|\.agent-presets|usage-accounting/i.test(installer)) {
  throw new Error('custom installer script must never address protected user data')
}

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(path))
    else files.push(path)
  }
  return files
}

async function hashes(root) {
  const result = {}
  for (const path of await filesBelow(root)) {
    const key = relative(root, path).replaceAll('\\', '/')
    result[key] = createHash('sha256').update(await readFile(path)).digest('hex')
  }
  return result
}

function changedKeys(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => before[key] !== after[key])
    .sort()
}

async function materializeEncodedSessions(appData) {
  const sessionsRoot = join(appData, 'harness', 'sessions')
  for (const source of await filesBelow(sessionsRoot)) {
    if (!source.endsWith('.base64')) continue
    const encodedText = (await readFile(source, 'utf8')).trim()
    const encoded = Buffer.from(encodedText, 'base64')
    assert(encoded.toString('base64') === encodedText, `invalid base64 session fixture ${source}`)
    await writeFile(source.slice(0, -'.base64'.length), encoded)
    await unlink(source)
  }
}

async function verifySessionData(appData) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(appData, 'harness', 'sessions') })
  try {
    const snapshots = await ctx.sessionPersistence.listSnapshots()
    assert(snapshots.length === 1 && snapshots[0]?.header.id === SESSION_ID,
      '0.1.9 session fixture is not discoverable through the rc.8 persistence backend')
    const session = await ctx.sessionPersistence.inspect(SESSION_ID)
    assert(session.meta.version === 0 && session.meta.agentPreset === 'fixture-persona',
      '0.1.9 session metadata or persona binding changed')
    assert(session.events.length === 7 && session.events.every((event, index) => event.seq === index),
      '0.1.9 session events are missing or non-contiguous')
    const title = session.events.find(event => event.type === 'session/title')
    assert(title?.data.title === '升级兼容会话', '0.1.9 session title is no longer readable')
    assert(session.events.some(event => event.type === 'user/message')
      && session.events.some(event => event.type === 'assistant/message'),
    '0.1.9 session messages are no longer readable')
  } finally {
    await ctx.fiber.dispose()
  }
}

async function verifyCredentialData(appData, scratch) {
  const source = join(appData, 'harness', '.credentials.yaml')
  const probeDir = join(scratch, 'credential-probe')
  const probe = join(probeDir, '.credentials.yaml')
  await mkdir(probeDir, { recursive: true })
  await copyFile(source, probe)

  const inherited = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  const ctx = new Context()
  const fiber = ctx.plugin(LocalCredentialProvider, { path: probe, watch: false })
  try {
    await fiber
    const info = await ctx.credentials.describe(CURRENT_KEY_REF)
    assert(info.configured && info.source === 'file' && info.writable,
      '0.1.9 API key is not readable and replaceable through the rc.8 credential provider')
    const resolved = await ctx.credentials.resolve(CURRENT_KEY_REF)
    assert(resolved?.value.length > 0, '0.1.9 API key resolved as empty')
    const fingerprint = createHash('sha256').update(resolved.value).digest('hex')
    await ctx.credentials.set(CURRENT_KEY_REF, 'fixture-replacement-not-a-real-key')
    const replaced = await ctx.credentials.resolve(CURRENT_KEY_REF)
    assert(replaced?.value === 'fixture-replacement-not-a-real-key' && replaced.source === 'file',
      'rc.8 credential provider could not replace the copied 0.1.9 API key')
    return fingerprint
  } finally {
    await fiber.dispose()
    if (inherited === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = inherited
  }
}

async function verifyPresetData(appData) {
  const presets = await discoverPresets([{
    path: join(appData, 'harness', '.agent-presets'),
    trust: 'user',
  }])
  const fixture = presets.find(preset => preset.id === 'fixture-persona')
  assert(fixture !== undefined && fixture.broken === undefined && fixture.name === '升级样本人格',
    '0.1.9 user-created agent preset is not readable by rc.8')
  const settings = await readFile(join(appData, 'harness', 'settings.yaml'), 'utf8')
  assert(settings.includes('agent-presets:\n  default: fixture-persona'),
    '0.1.9 default agent preset selection is missing')
  assert(settings.includes('agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-flash'),
    '0.1.9 default model selection is missing')
}

async function verifyUsageData(appData, currentKeyFingerprint) {
  const path = join(appData, 'harness', 'usage-accounting', 'usage-v1.json')
  const ledger = JSON.parse(await readFile(path, 'utf8'))
  assert(ledger.schemaVersion === 1 && ledger.trackingSince === '2026-08-20'
    && Array.isArray(ledger.records) && ledger.records.length === 3,
  '0.1.9 usage ledger schema or record set changed')

  for (const record of ledger.records) {
    const usage = {
      cacheHitInputTokens: record.cacheHitInputTokens,
      cacheMissInputTokens: record.cacheMissInputTokens,
      outputTokens: record.outputTokens,
      cacheWriteTokens: record.cacheWriteTokens,
    }
    const priced = priceUsage(EMBEDDED_PRICE_TABLE, record.model, usage, Date.parse(record.occurredAt), true)
    assert(priced.priceVersion === record.priceVersion
      && String(priced.cacheHitInputCostNanoyuan) === record.cacheHitInputCostNanoyuan
      && String(priced.cacheMissInputCostNanoyuan) === record.cacheMissInputCostNanoyuan
      && String(priced.outputCostNanoyuan) === record.outputCostNanoyuan
      && String(priced.costNanoyuan) === record.costNanoyuan
      && priced.unpricedTokens === record.unpricedTokens,
    `0.1.9 usage settlement ${record.requestId} no longer matches the embedded tariff`)
  }

  const current = ledger.records.filter(record => record.keyFingerprint === currentKeyFingerprint)
  const old = ledger.records.filter(record => record.keyFingerprint !== currentKeyFingerprint)
  const totals = current.reduce((sum, record) => ({
    tokens: sum.tokens + record.cacheHitInputTokens + record.cacheMissInputTokens
      + record.outputTokens + record.cacheWriteTokens,
    cacheHit: sum.cacheHit + BigInt(record.cacheHitInputCostNanoyuan),
    cacheMiss: sum.cacheMiss + BigInt(record.cacheMissInputCostNanoyuan),
    output: sum.output + BigInt(record.outputCostNanoyuan),
    cost: sum.cost + BigInt(record.costNanoyuan),
  }), { tokens: 0, cacheHit: 0n, cacheMiss: 0n, output: 0n, cost: 0n })
  assert(current.length === 2 && old.length === 1 && totals.tokens === 4300
    && totals.cacheHit === 120000n && totals.cacheMiss === 6750000n
    && totals.output === 3150000n && totals.cost === 10020000n,
  '0.1.9 current-key usage totals, category costs, or old-key isolation changed')
}

const fixtureAppData = join(fixtureRoot, 'app-data')
const scratch = await mkdtemp(join(tmpdir(), 'xiaojing-upgrade-data-'))
try {
  const appData = join(scratch, 'app-data')
  const documents = join(scratch, 'documents')
  const install = join(scratch, identity.installDirectoryName)
  await cp(fixtureAppData, appData, { recursive: true })
  await cp(join(fixtureRoot, 'documents'), documents, { recursive: true })
  await materializeEncodedSessions(appData)

  const fixtureFiles = (await filesBelow(appData)).map(path => relative(appData, path).replaceAll('\\', '/'))
  for (const protectedPath of contract.protectedPaths) {
    assert(fixtureFiles.some(path => path === protectedPath || path.startsWith(`${protectedPath}/`)),
      `${fixtureVersion} upgrade fixture does not cover protected path ${protectedPath}`)
  }

  const before = { appData: await hashes(appData), documents: await hashes(documents) }
  await mkdir(install, { recursive: true })
  await writeFile(join(install, 'old-application-file.txt'), fixtureVersion)
  await writeFile(join(install, 'new-application-file.txt'), manifest.version)
  const afterApplicationReplacement = { appData: await hashes(appData), documents: await hashes(documents) }
  assert(JSON.stringify(afterApplicationReplacement) === JSON.stringify(before),
    `synthetic in-place application replacement changed protected ${fixtureVersion} user data`)

  const profileBefore = await hashes(appData)
  const profile = loadProfile(
    'xiaojing-upgrade-fixture',
    'web',
    join(repositoryRoot, 'apps', 'cli', 'package.json'),
    join(appData, 'harness'),
    { userLayer: false },
  )
  assert(JSON.stringify(profile.layers.map(layer => layer.packageName)) === JSON.stringify(EXPECTED_WEB_BUNDLES),
    'the default 0.1.9 Web profile did not migrate to base + web-app + file uploads')
  const profileAfter = await hashes(appData)
  const expectedProfileChange = 'harness/profiles/web/package.json'
  assert(JSON.stringify(changedKeys(profileBefore, profileAfter)) === JSON.stringify([expectedProfileChange]),
    'profile migration changed data beyond the exact installation-owned Web manifest')
  const migratedManifest = JSON.parse(await readFile(join(appData, expectedProfileChange), 'utf8'))
  assert(migratedManifest.xiaojingFixture === 'preserve-this-field'
    && JSON.stringify(migratedManifest.dsh?.profile?.bundles) === JSON.stringify(EXPECTED_WEB_BUNDLES),
  'profile migration did not preserve unrelated manifest fields or remove ModLens exactly')

  const currentKeyFingerprint = await verifyCredentialData(appData, scratch)
  await verifySessionData(appData)
  await verifyPresetData(appData)
  await verifyUsageData(appData, currentKeyFingerprint)
  const afterReadChecks = await hashes(appData)
  assert(JSON.stringify(afterReadChecks) === JSON.stringify(profileAfter),
    'rc.8 compatibility reads unexpectedly rewrote protected user data')
  assert(JSON.stringify(await hashes(documents)) === JSON.stringify(before.documents),
    'rc.8 compatibility checks changed the Documents workspace')
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log(`desktop ${fixtureVersion} -> ${manifest.version} user-data compatibility contract verified`)
