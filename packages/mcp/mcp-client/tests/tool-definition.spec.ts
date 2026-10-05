import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Client, InMemoryTransport, SdkError, SdkErrorCode } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createMcpToolDefinition } from '../src/index.ts'
import { syncTools } from '../src/tools.ts'

describe('MCP result callback adaptation', () => {
  it.each([false, true])('distinguishes a detached SDK Client from a connected business refusal (detached=%s)', async (detached) => {
    const ctx = new Context()
    const client = new Client({ name: 'detached-client-test', version: '1' })
    const server = new McpServer({ name: 'business-error-test', version: '1' })
    let calls = 0
    server.registerTool('read', {}, async () => {
      calls += 1
      return { isError: true, content: [{ type: 'text', text: 'Not connected' }] }
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const serving = serveStdio(() => server, { transport: serverTransport })
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await client.connect(clientTransport)
      await syncTools(client, ctx, { serverName: 'fixture', registrationFailure: 'throw', toolCallTimeoutMs: 1_000 }, new Map())
      if (detached) {
        await client.close()
        expect(client.transport).toBeUndefined()
        const raw = await client.callTool({ name: 'read', arguments: {} }).catch((error: unknown) => error)
        expect(raw).toBeInstanceOf(Error)
        expect(raw).not.toBeInstanceOf(SdkError)
      }
      const result = await ctx.tools.execute({
        name: 'mcp__fixture__read', callId: ToolCallId('detached-client-call'), arguments: {}, signal: new AbortController().signal,
      })
      expect(result.isError).toBe(true)
      expect(result.error?.message).toBe('Not connected')
      expect(result.error?.info).toEqual(detached ? { name: 'McpTransportError', code: 'NOT_CONNECTED' } : undefined)
      expect(calls).toBe(detached ? 0 : 1)
    } finally {
      await client.close()
      await serving.close()
      await ctx.fiber.dispose()
    }
  })

  it.each([SdkErrorCode.NotConnected, SdkErrorCode.ConnectionClosed])('preserves confirmed SDK transport code %s in runtime results', async (code) => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      const observed: ToolExecutionResult[] = []
      ctx.on('tools/result', (_exec, result) => { observed.push(result) })
      ctx.tools.register(createMcpToolDefinition(ctx, {
        name: 'lost_transport', rawName: 'read', description: 'Read through the fixture connection.',
        inputSchema: { type: 'object' }, call: async () => { throw new SdkError(code, 'Fixture transport unavailable') },
      }))
      const result = await ctx.tools.execute({
        name: 'lost_transport', callId: ToolCallId('transport-call'), arguments: {}, signal: new AbortController().signal,
      })
      expect(result).toMatchObject({ isError: true, error: { message: 'Fixture transport unavailable', info: { name: 'McpTransportError', code } } })
      expect(observed).toEqual([result])
      if (code === SdkErrorCode.ConnectionClosed) {
        expect(observed).toMatchInlineSnapshot(`
          [
            {
              "content": [
                {
                  "text": "Error: Fixture transport unavailable",
                  "type": "text",
                },
              ],
              "error": {
                "info": {
                  "code": "CONNECTION_CLOSED",
                  "name": "McpTransportError",
                },
                "message": "Fixture transport unavailable",
              },
              "isError": true,
            },
          ]
        `)
      }
    } finally { await ctx.fiber.dispose() }
  })

  it.each([
    new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out'),
    Object.assign(new Error('Not connected'), { name: 'SdkError', code: SdkErrorCode.NotConnected }),
    { isError: true, content: [{ type: 'text', text: 'Connection closed' }] },
  ])('does not identify timeout, unbranded errors, or server text as transport loss (%j)', async (failure) => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      ctx.tools.register(createMcpToolDefinition(ctx, {
        name: 'ordinary_failure', rawName: 'read', description: 'Read fixture.', inputSchema: { type: 'object' },
        call: async () => { if (failure instanceof Error) throw failure; return failure },
      }))
      const result = await ctx.tools.execute({
        name: 'ordinary_failure', callId: ToolCallId('failure-call'), arguments: {}, signal: new AbortController().signal,
      })
      expect(result.isError).toBe(true)
      expect(result.error?.info).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })

  it('preserves the exact execution, arguments and canonical structured results', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      let execution: ToolExecution | undefined
      ctx.on('tools/execute', (exec, next) => {
        execution = exec
        return next()
      })
      const call = vi.fn(async () => ({
        content: [{ type: 'text', text: 'Observed window.' }],
        structuredContent: { window: 7 },
      }))
      ctx.tools.register(createMcpToolDefinition(ctx, {
        name: 'native_window', rawName: 'window', description: 'Read the selected window.',
        inputSchema: { type: 'object', properties: { window: { type: 'integer' } } },
        outputSchema: { type: 'object', properties: { window: { type: 'integer' } }, required: ['window'] },
        call,
      }))
      const signal = new AbortController().signal
      const result = await ctx.tools.execute({
        name: 'native_window', callId: ToolCallId('window-call'), arguments: { window: 7 }, signal,
      })
      expect(call).toHaveBeenCalledWith({ window: 7 }, execution)
      expect(execution?.signal).toBe(signal)
      expect(result.isError).toBe(false)
      expect(result.value).toEqual({
        content: [{ type: 'text', text: 'Observed window.' }], structuredContent: { window: 7 },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([null, { content: [42] }, { content: [{ type: 'image' }] }])(
    'rejects invalid external results before exposing content (%j)', async (invalid) => {
      const ctx = new Context()
      try {
        await ctx.plugin(SystemPrompt)
        await ctx.plugin(ToolRuntime)
        ctx.tools.register(createMcpToolDefinition(ctx, {
          name: 'invalid_result', rawName: 'invalid', description: 'External result fixture.',
          inputSchema: { type: 'object' }, call: async () => invalid,
        }))
        const result = await ctx.tools.execute({
          name: 'invalid_result', callId: ToolCallId('invalid-call'), arguments: {},
          signal: new AbortController().signal,
        })
        expect(result.isError).toBe(true)
        expect(result.value).toBeUndefined()
      } finally {
        await ctx.fiber.dispose()
      }
    },
  )
})
