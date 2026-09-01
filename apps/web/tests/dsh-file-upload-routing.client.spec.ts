// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInThisContext } from 'node:vm'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

interface DynamicClientModule {
  inject: readonly string[]
  apply(ctx: Record<string, unknown>): void
}

interface DynamicRegistration {
  id: string
  factory(require: (id: string) => unknown): DynamicClientModule
}

function loadPatchedClient(): DynamicClientModule {
  const requireFromCli = createRequire(join(process.cwd(), 'apps', 'cli', 'package.json'))
  const source = readFileSync(requireFromCli.resolve('dsh-file-uploads/client'), 'utf8')
  let registration: DynamicRegistration | undefined
  Object.assign(window, {
    __ModuleLoader__: {
      load(value: DynamicRegistration) { registration = value },
    },
  })
  runInThisContext(source)
  if (registration === undefined) throw new Error('dsh-file-uploads did not register its client module')
  return registration.factory((id) => {
    if (id === 'react') return React
    throw new Error(`unexpected dynamic import ${id}`)
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as { __ModuleLoader__?: unknown }).__ModuleLoader__
})

describe('patched dsh-file-uploads client', () => {
  it.each([
    ['普通', 'plain', undefined],
    ['Goal', 'claimed', { token: '/goal ', hint: '目标', images: true }],
    ['Plan', 'claimed', { token: '/plan ', hint: '计划', images: true }],
  ] as const)('routes images and documents through the unified picker in %s mode', async (_label, phase, claim) => {
    const module = loadPatchedClient()
    const entries = new Map<string, React.ComponentType<Record<string, unknown>>>()
    let referenceCodec: { serialize(ref: string): Promise<string> } | undefined
    const insertedRefs: string[] = []
    const shell = {
      snapshot: {
        phase,
        draft: '',
        draftRev: 0,
        occurrences: [] as Array<{
          occurrenceId: number
          source: string
          ref: string
          offset: number
          length: number
          label: string
          clipboardText: string
        }>,
        imageIds: [] as string[],
        ...(claim === undefined ? {} : { claim }),
      },
      setDraft: vi.fn<(draft: string) => void>(),
      removeImage: vi.fn((id: string) => {
        shell.snapshot.imageIds = shell.snapshot.imageIds.filter(candidate => candidate !== id)
      }),
    }
    const imageIntake = vi.fn(() => {
      shell.snapshot.imageIds = ['image-1']
      return { ok: true as const }
    })
    const preparedOriginalNames: string[] = []
    const prepareUpload = vi.fn((
      _context: unknown,
      _event: string,
      request: { readonly originalName: string },
    ) => {
      preparedOriginalNames.push(request.originalName)
      return Promise.resolve(undefined)
    })
    const actx = {
      get: (name: string) => name === 'conversation' ? { addImages: imageIntake } : undefined,
      serial: prepareUpload,
      bail: (_ctx: unknown, _event: string, request: {
        reference: { source: string; ref: string; label: string; clipboardText: string }
      }) => {
        const displayText = `@${request.reference.label}`
        const offset = shell.snapshot.draft.length
        insertedRefs.push(request.reference.ref)
        shell.snapshot.occurrences.push({
          occurrenceId: insertedRefs.length,
          source: request.reference.source,
          ref: request.reference.ref,
          offset,
          length: displayText.length,
          label: request.reference.label,
          clipboardText: request.reference.clipboardText,
        })
        shell.snapshot.draft += `${displayText} `
        shell.snapshot.draftRev += 1
        return true
      },
    }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const file = init.body as File
      return new Response(JSON.stringify({
        file: { name: file.name, path: `C:\\uploads\\${file.name}`, size: file.size },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = {
      sessions: { scope: () => actx },
      conversation: { input: { for: () => shell } },
      timeout: () => () => undefined,
      inputTriggers: {
        registerSource(source: { codec: { serialize(ref: string): Promise<string> } }) {
          referenceCodec = source.codec
          return () => undefined
        },
      },
      slots: {
        inject(_name: string, register: () => void) { register() },
        register(meta: { id: string }, component: React.ComponentType<Record<string, unknown>>) {
          entries.set(meta.id, component)
          return () => undefined
        },
      },
      effect(factory: () => unknown) { factory() },
    }
    module.apply(ctx)
    const Upload = entries.get('local-file-upload')
    if (Upload === undefined) throw new Error('upload control was not registered')
    const limits = {
      maxImageBytes: 3_500_000,
      maxImagesPerMessage: 20,
      maxMessageImageBytes: 100_000_000,
      maxImagePixels: 40_000_000,
      maxImageDimension: 2000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    }
    const view = render(React.createElement(Upload, {
      sessionId: 'session-1',
      input: shell.snapshot,
      useInput: (selector: (value: typeof shell.snapshot) => unknown) => selector(shell.snapshot),
      useProjection: (key: string) => key === 'imageLimits' ? limits : undefined,
    }))
    const picker = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const png = new File([Uint8Array.of(1)], 'invoice.png', { type: 'image/png' })
    const pdf = new File([Uint8Array.of(2)], 'invoice.pdf', { type: 'application/pdf' })
    const bmp = new File([Uint8Array.of(3)], 'scan.bmp', { type: 'image/bmp' })
    const pptx = new File([Uint8Array.of(4)], 'briefing.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    fireEvent.change(picker, { target: { files: [png, pdf, bmp, pptx] } })

    await waitFor(() => { expect(view.getByText('已添加 1 张图片、3 个文件')).toBeTruthy() })
    expect(imageIntake).toHaveBeenCalledWith([png], limits)
    expect(prepareUpload).toHaveBeenCalledTimes(4)
    expect(preparedOriginalNames).toEqual([
      'invoice.png', 'invoice.pdf', 'scan.bmp', 'briefing.pptx',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect((view.getByRole('button', { name: '上传文件' }) as HTMLButtonElement).disabled).toBe(false)
    expect(insertedRefs).toHaveLength(3)
    if (referenceCodec === undefined) throw new Error('reference codec was not registered')
    const serialized = await Promise.all(insertedRefs.map(ref => referenceCodec!.serialize(ref)))
    expect(serialized.some(text => text.includes('上传文件：`C:\\uploads\\invoice.pdf`'))).toBe(true)
    expect(serialized.some(text => text.includes('上传文件：`C:\\uploads\\briefing.pptx`'))).toBe(true)
    expect(serialized.some(text => text.includes('上传文件（当前格式不能直接视觉识别）：`C:\\uploads\\scan.bmp`'))).toBe(true)
    const Rail = entries.get('local-file-upload-rail')
    if (Rail === undefined) throw new Error('pending upload rail was not registered')
    const rail = render(React.createElement(Rail, {
      sessionId: 'session-1',
      useInput: (selector: (value: typeof shell.snapshot) => unknown) => selector(shell.snapshot),
      useSession: (selector: (value: { promptError: null }) => unknown) => selector({ promptError: null }),
    }))
    const [pdfRef, bmpRef] = insertedRefs
    if (pdfRef === undefined || bmpRef === undefined) throw new Error('document references were not inserted')
    const expectedDraft = shell.snapshot.draft.replace(`@__dsh_upload_hidden__:${pdfRef} `, '')
    fireEvent.click(rail.getByRole('button', { name: /invoice\.pdf$/ }))
    expect(shell.setDraft).toHaveBeenLastCalledWith(expectedDraft)
    const cleanedDraft = shell.setDraft.mock.lastCall?.[0]
    expect(cleanedDraft).not.toContain(pdfRef)
    expect(cleanedDraft).toContain(bmpRef)
  })
})
