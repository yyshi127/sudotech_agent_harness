import { defineConfig } from 'tsdown'

/** Build the Host service and preset consumers as independent public entries. */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/context.js', 'lib/types/capabilities.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/files-tool.js', 'lib/types/vouchers-tool.js', 'lib/types/references-tool.js', 'lib/types/balances-tool.js', 'lib/types/journals-tool.js', 'lib/types/open-items-tool.js', 'lib/types/open-item-analysis-tool.js', 'lib/types/voucher-preparation-tool.js', 'lib/types/journal-preparation-tool.js', 'lib/types/master-data-preparation-tool.js', 'lib/types/open-item-preparation-tool.js', 'lib/types/voucher-deletion-tool.js', 'lib/types/journal-deletion-tool.js', 'lib/types/open-item-deletion-tool.js', 'lib/types/open-item-write-off-tool.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
