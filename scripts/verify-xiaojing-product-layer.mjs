import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'packages', 'client', 'xiaojing-product', 'product.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

const expectedBaseline = {
  remote: 'https://github.com/deepseek-ai/deepseek-harness.git',
  release: '0.1.0-rc.5',
  commit: 'abe560f81edebe5f6a5b62706ff502daa0dccd40',
}
if (manifest.schemaVersion !== 1
  || JSON.stringify(manifest.upstream) !== JSON.stringify(expectedBaseline)) {
  throw new Error('xiaojing product upstream baseline changed without an explicit manifest update')
}

const coreRoots = [
  'packages/client/ui-sidebar/src',
  'packages/client/ui-conversation/src',
  'packages/client/ui-settings-models/src',
  'packages/client/ui-theme/src',
  'packages/client/web/src',
]
const productMarks = /小兢|数豆|SUDO|sdoobot|sudo-logo|xiaojing-product/i
const errors = []

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

for (const directory of coreRoots) {
  for (const file of await sourceFiles(join(root, directory))) {
    const source = await readFile(file, 'utf8')
    if (productMarks.test(source)) errors.push(relative(root, file).replaceAll('\\', '/'))
  }
}

const composition = await readFile(join(root, 'packages', 'bundle', 'web-app', 'cordis.patch.yml'), 'utf8')
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

if (errors.length > 0) {
  throw new Error(`xiaojing product isolation failed:\n${errors.map(error => `- ${error}`).join('\n')}`)
}
console.log(`xiaojing product layer verified against upstream ${manifest.upstream.release}`)
