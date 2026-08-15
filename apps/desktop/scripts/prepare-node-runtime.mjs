import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const target = resolve(import.meta.dirname, '..', 'build', 'node.exe')

await mkdir(dirname(target), { recursive: true })
await copyFile(process.execPath, target)

const { size } = await stat(target)
console.log(`Bundled Node.js ${process.version}: ${target} (${size} bytes)`)
