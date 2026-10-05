/** Deliver console interrupts to CLI listeners in Electron's Windows Node mode. */

/**
 * Register the CLI process's Windows console handler.
 * An unattached CLI joins its parent's console when one exists; background use remains supported.
 * Koffi queues callbacks from the console thread onto the JavaScript thread.
 * The registration lasts until process exit; unknown events retain native handling.
 * @returns Completion once the console handler is registered.
 */
export async function installWindowsCliSignals(): Promise<void> {
  const { default: koffi } = await import('koffi')
  const kernel = koffi.load('kernel32.dll')
  const codePage = kernel.func('uint32_t __stdcall GetConsoleCP()')
  if (codePage() === 0) {
    const attach = kernel.func('int __stdcall AttachConsole(uint32_t processId)')
    if (!attach(0xffffffff)) {
      const error: unknown = kernel.func('uint32_t __stdcall GetLastError()')()
      // Redirected/background commands can have no console or no remaining parent.
      if (error !== 6 && error !== 87) throw new Error(`desktop CLI: cannot attach the parent console (${String(error)})`)
    }
  }
  const type = koffi.proto('int __stdcall DshCliConsoleHandler(uint32_t event)')
  const handler = koffi.register((event: number) => {
    if (event === 0) return Number(process.emit('SIGINT'))
    if (event === 1) return Number(process.emit('SIGBREAK'))
    return 0
  }, koffi.pointer(type))
  const install = kernel.func('int __stdcall SetConsoleCtrlHandler(DshCliConsoleHandler *handler, int add)')
  if (!install(handler, 1)) {
    koffi.unregister(handler)
    throw new Error('desktop CLI: cannot register the Windows console handler')
  }
}
