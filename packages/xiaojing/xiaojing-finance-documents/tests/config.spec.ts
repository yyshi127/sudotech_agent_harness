import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('xiaojing finance document configuration', () => {
  it('accepts documents up to the bundled upload limit by default', () => {
    expect(Config({}).maxFileBytes).toBe(100 * 1024 * 1024)
  })
})
