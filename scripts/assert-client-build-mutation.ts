/** Guard direct Client compilation from overwriting a recorded profile build. */

import { resolve } from 'node:path'
import { assertClientBuildMutationAllowed } from './client-build-environment.ts'

/** Validate the environment before any Client artifact is mutated. */
function main(): void {
  assertClientBuildMutationAllowed(resolve(import.meta.dirname, '..'), process.env)
}

if (import.meta.main) main()
