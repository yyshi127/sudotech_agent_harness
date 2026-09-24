import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { launchWebScaffold, webClientProfile, type WebScaffold } from './scaffold.ts'

let scaffold: WebScaffold | undefined
let home: string | undefined

afterEach(async () => {
  try {
    await scaffold?.close()
  } finally {
    scaffold = undefined
    vi.unstubAllEnvs()
    if (home !== undefined) await rm(home, { recursive: true, force: true })
    home = undefined
  }
})

it.skipIf(webClientProfile() !== 'xiaojing').each([
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
])('upgrades the saved %s selection on shipped Xiaojing boot', async (legacyModel) => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  home = await mkdtemp(join(tmpdir(), 'xiaojing-model-upgrade-'))
  await writeFile(join(home, 'settings.yaml'), [
    'agent-default-model:',
    '  provider: deepseek-official',
    `  model: ${legacyModel}`,
    'llm-deepseek:',
    '  models:',
    '    - id: deepseek-v4-flash',
    '      name: DeepSeek-V4-Flash',
    '      contextWindow: 1000000',
    '    - id: deepseek-v4-pro',
    '      name: DeepSeek-V4-Pro',
    '      contextWindow: 1000000',
    '    - id: deepseek-v4-flash-vision-exp',
    '      name: DeepSeek-V4-Flash-Vision-Exp',
    '      contextWindow: 1000000',
    '      inputModalities:',
    '        - text',
    '        - image',
    'custom-upgrade-marker:',
    '  keep: preserved',
    '',
  ].join('\n'))

  scaffold = await launchWebScaffold({ harnessHome: home, deepSeekMissingCredential: true })
  const assembled = await scaffold.ctx.systemPrompt.assemble()
  expect(assembled.sections.some(section => section.name === 'xiaojing:business-facing-responses')).toBe(true)
  await expect.poll(() => scaffold?.ctx.agentDefaultModel.currentSelection().model).toBe('deepseek-flash')
  await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'deepseek-flash')).resolves.toMatchObject({
    inputModalities: ['text', 'image'],
  })
  await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'deepseek-v4-flash-vision-exp')).resolves.toMatchObject({
    inputModalities: ['text', 'image'],
    systemPromptUpdate: 'in-history',
  })
  expect((await scaffold.ctx.llm.listModels('deepseek-official')).map(model => model.id))
    .toEqual(['deepseek-flash'])
  const saved = await readFile(join(home, 'settings.yaml'), 'utf8')
  expect(saved).toContain('model: deepseek-flash')
  expect(saved).toContain('keep: preserved')
  expect(saved).not.toContain('deepseek-v4-flash-vision-exp')
})

it.skipIf(webClientProfile() !== 'xiaojing')('keeps customized DeepSeek entries while adding native Flash', async () => {
  vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'xiaojing')
  home = await mkdtemp(join(tmpdir(), 'xiaojing-model-upgrade-'))
  await writeFile(join(home, 'settings.yaml'), [
    'agent-default-model:',
    '  provider: deepseek-official',
    '  model: deepseek-v4-flash-vision-exp',
    'llm-deepseek:',
    '  models:',
    '    - id: deepseek-v4-flash-vision-exp',
    '      name: My Legacy Vision',
    '      inputModalities:',
    '        - text',
    '        - image',
    '    - id: private-preview',
    '      name: Private Preview',
    '',
  ].join('\n'))

  scaffold = await launchWebScaffold({ harnessHome: home, deepSeekMissingCredential: true })
  await expect.poll(() => scaffold?.ctx.agentDefaultModel.currentSelection().model).toBe('deepseek-flash')
  await expect(scaffold.ctx.llm.resolveModelInfo('deepseek-official', 'deepseek-flash')).resolves.toMatchObject({
    inputModalities: ['text', 'image'],
  })
  const saved = await readFile(join(home, 'settings.yaml'), 'utf8')
  expect(saved).toContain('name: My Legacy Vision')
  expect(saved).toContain('name: Private Preview')
  expect(saved).toContain('id: deepseek-flash')
})
