/** Disposable executable fixture for the production managed Edge startup and ownership checks. */
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [profileDir] = process.argv.slice(2)
const server = createServer((_request, response) => { response.end('{}') })
server.listen(0, '127.0.0.1', async () => {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Edge executable fixture has no TCP listener')
  await writeFile(join(profileDir, 'DevToolsActivePort'), `${address.port}\n/devtools/browser/fixture-edge\n`)
})
