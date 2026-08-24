/** The original dsh-visualize whale-blue light palette, kept independent of the host. */
const NATIVE_THEME_VARS: Readonly<Record<string, string>> = {
  foreground: 'rgb(26 28 31)',
  card: 'rgb(0 0 0 / 4%)',
  'muted-foreground': 'rgb(26 28 31 / 55%)',
  border: 'rgb(0 0 0 / 10%)',
  primary: 'rgb(65 118 230)',
  'primary-foreground': 'rgb(255 255 255)',
}

/** The fixed native palette and scheme for one frame document build. */
interface ResolvedTheme {
  themeVars: Record<string, string>
  colorScheme: 'light' | 'dark'
}

/** Resolve the plugin's fixed native palette without reading host theme state. */
export function resolveTheme(): ResolvedTheme {
  return { themeVars: { ...NATIVE_THEME_VARS }, colorScheme: 'light' }
}
