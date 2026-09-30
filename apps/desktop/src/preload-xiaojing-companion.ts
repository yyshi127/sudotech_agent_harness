/** Sandboxed preload for the transparent Xiaojing companion window. */

import { exposeXiaojingDesktopBridge, installXiaojingCompanionPointerBridge } from './xiaojing-preload.ts'

exposeXiaojingDesktopBridge()
installXiaojingCompanionPointerBridge()
