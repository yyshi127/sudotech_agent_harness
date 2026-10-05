import { defineConfig, type UserConfig } from 'tsdown'

/** Build each published browser entry without shared runtime chunks. */
export default defineConfig(['index', 'native', 'native-settings'].map<UserConfig>(entry => ({
  entry: [`lib/types/${entry}.js`],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
})))
