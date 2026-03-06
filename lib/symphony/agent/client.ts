import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { AgentEvent, ResolvedConfig, SymphonyError } from '../types'
import {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  SessionStartedParams,
  TurnCompletedParams,
  TurnFailedParams,
  TurnInputRequiredParams,
  UnsupportedToolCallParams,
} from './protocol'
import { executeLinearGraphQL } from '../tracker/linear'

const log = (...args: unknown[]) => console.log('[symphony:agent]', ...args)

const MAX_LINE_BYTES = 10 * 1024 * 1024 // 10 MB

let _reqId = 1
function nextId() {
  return _reqId++
}

export interface AgentSession {
  pid: number
  sessionId: string | null
  threadId: string | null
  events: EventEmitter
  sendTurn(prompt: string, turnId?: string): Promise<TurnResult>
  close(): void
}

export interface TurnResult {
  success: boolean
  threadId: string
  turnId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  message: string
  error?: string
}

export async function startSession(
  config: ResolvedConfig,
  workspacePath: string,
): Promise<AgentSession> {
  const proc = spawn('bash', ['-lc', config.codex_command], {
    cwd: workspacePath,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const events = new EventEmitter()
  let sessionId: string | null = null
  let threadId: string | null = null
  let lineBuffer = ''

  // Pending RPC response resolvers
  const pendingRpc = new Map<
    string | number,
    { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }
  >()

  function sendRaw(msg: JsonRpcRequest | JsonRpcNotification) {
    const line = JSON.stringify(msg) + '\n'
    proc.stdin.write(line)
  }

  function sendRequest(msg: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      pendingRpc.set(msg.id, { resolve, reject })
      sendRaw(msg)
    })
  }

  function handleLine(line: string) {
    if (!line.trim()) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      const ev: AgentEvent = { type: 'malformed', message: line }
      events.emit('event', ev)
      return
    }

    // Is it a response to one of our requests?
    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const resp = msg as unknown as JsonRpcResponse
      const pending = pendingRpc.get(resp.id)
      if (pending) {
        pendingRpc.delete(resp.id)
        pending.resolve(resp)
        return
      }
    }

    // It's a notification
    const notif = msg as unknown as JsonRpcNotification
    const method = notif.method as string
    const params = notif.params as Record<string, unknown> | undefined

    switch (method) {
      case 'session_started': {
        const p = params as unknown as SessionStartedParams
        sessionId = p.sessionId
        const ev: AgentEvent = { type: 'session_started', session_id: sessionId }
        events.emit('event', ev)
        break
      }
      case 'startup_failed': {
        const ev: AgentEvent = {
          type: 'startup_failed',
          message: (params as { error?: string })?.error,
        }
        events.emit('event', ev)
        break
      }
      case 'turn_completed': {
        const p = params as unknown as TurnCompletedParams
        const ev: AgentEvent = {
          type: 'turn_completed',
          thread_id: p.threadId,
          turn_id: p.turnId,
          input_tokens: p.inputTokens ?? 0,
          output_tokens: p.outputTokens ?? 0,
          total_tokens: p.totalTokens ?? 0,
          message: p.message ?? '',
        }
        events.emit('event', ev)
        break
      }
      case 'turn_failed': {
        const p = params as unknown as TurnFailedParams
        const ev: AgentEvent = {
          type: 'turn_failed',
          thread_id: p.threadId,
          turn_id: p.turnId,
          message: p.error,
        }
        events.emit('event', ev)
        break
      }
      case 'turn_cancelled': {
        const p = params as unknown as TurnFailedParams
        const ev: AgentEvent = {
          type: 'turn_cancelled',
          thread_id: p.threadId,
          turn_id: p.turnId,
        }
        events.emit('event', ev)
        break
      }
      case 'turn_ended_with_error': {
        const ev: AgentEvent = { type: 'turn_ended_with_error', data: params }
        events.emit('event', ev)
        break
      }
      case 'turn_input_required': {
        const p = params as unknown as TurnInputRequiredParams
        const ev: AgentEvent = {
          type: 'turn_input_required',
          thread_id: p.threadId,
          turn_id: p.turnId,
          message: p.prompt,
        }
        events.emit('event', ev)
        break
      }
      case 'approval_auto_approved': {
        const ev: AgentEvent = { type: 'approval_auto_approved', data: params }
        events.emit('event', ev)
        break
      }
      case 'unsupported_tool_call': {
        const p = params as unknown as UnsupportedToolCallParams
        // Handle linear_graphql tool if configured
        if (
          p.toolName === 'linear_graphql' &&
          config.tracker_kind === 'linear' &&
          config.tracker_api_key
        ) {
          void handleLinearTool(
            p,
            params as Record<string, unknown>,
            config,
            sendRaw,
          )
        } else {
          const ev: AgentEvent = {
            type: 'unsupported_tool_call',
            tool_name: p.toolName,
            message: p.message,
          }
          events.emit('event', ev)
          // Return failure to agent so it can continue
          sendRaw({
            jsonrpc: '2.0',
            method: 'tool_result',
            params: {
              toolName: p.toolName,
              success: false,
              error: `Tool ${p.toolName} is not supported`,
            },
          })
        }
        break
      }
      default: {
        const ev: AgentEvent = { type: 'other_message', data: msg }
        events.emit('event', ev)
        break
      }
    }
  }

  async function handleLinearTool(
    p: UnsupportedToolCallParams,
    params: Record<string, unknown>,
    cfg: ResolvedConfig,
    send: (msg: JsonRpcNotification) => void,
  ) {
    const input = params?.input as { query?: string; variables?: Record<string, unknown> } | undefined
    try {
      const data = await executeLinearGraphQL(
        cfg.tracker_api_key,
        input?.query ?? '',
        input?.variables ?? {},
      )
      send({
        jsonrpc: '2.0',
        method: 'tool_result',
        params: { toolName: p.toolName, success: true, data },
      })
    } catch (err) {
      send({
        jsonrpc: '2.0',
        method: 'tool_result',
        params: {
          toolName: p.toolName,
          success: false,
          error: (err as Error).message,
        },
      })
    }
  }

  proc.stderr?.on('data', (d: Buffer) => {
    log('stderr:', d.toString().trim())
  })

  proc.stdout?.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString('utf-8')
    // Guard against runaway lines
    if (lineBuffer.length > MAX_LINE_BYTES) {
      lineBuffer = lineBuffer.slice(-MAX_LINE_BYTES)
    }
    let newlineIdx: number
    while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, newlineIdx)
      lineBuffer = lineBuffer.slice(newlineIdx + 1)
      handleLine(line)
    }
  })

  proc.on('close', () => {
    events.emit('close')
    // Reject any still-pending RPC calls
    for (const [id, p] of pendingRpc) {
      p.reject(new Error(`Process closed before response for request ${id}`))
    }
    pendingRpc.clear()
  })

  // Helper: wait for a specific event type with timeout
  function waitForEvent(
    type: string,
    timeoutMs: number,
  ): Promise<AgentEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for agent event: ${type}`)),
        timeoutMs,
      )
      function handler(ev: AgentEvent) {
        if (ev.type === type || ev.type === 'startup_failed') {
          clearTimeout(timer)
          events.off('event', handler)
          if (ev.type === 'startup_failed') {
            reject(
              new SymphonyError(
                'agent_startup_failed',
                `Agent startup failed: ${ev.message}`,
              ),
            )
          } else {
            resolve(ev)
          }
        }
      }
      events.on('event', handler)
    })
  }

  // ── Handshake ────────────────────────────────────────────────────────────────
  // 1. initialize
  const initReq = {
    jsonrpc: '2.0' as const,
    id: nextId(),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'symphony', version: '1.0.0' },
    },
  }
  const initResp = await Promise.race([
    sendRequest(initReq),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('initialize response timeout')),
        config.read_timeout_ms,
      ),
    ),
  ])
  if (initResp.error) {
    throw new SymphonyError(
      'agent_startup_failed',
      `initialize failed: ${initResp.error.message}`,
    )
  }

  // 2. initialized notification
  sendRaw({ jsonrpc: '2.0', method: 'initialized' })

  // 3. Wait for session_started
  const sessionEv = await Promise.race([
    waitForEvent('session_started', config.read_timeout_ms),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('session_started timeout')),
        config.read_timeout_ms,
      ),
    ),
  ])
  sessionId = sessionEv.session_id ?? null

  // 4. thread/start
  const threadReq = {
    jsonrpc: '2.0' as const,
    id: nextId(),
    method: 'thread/start',
    params: {},
  }
  const threadResp = await Promise.race([
    sendRequest(threadReq),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('thread/start response timeout')),
        config.read_timeout_ms,
      ),
    ),
  ])
  if (threadResp.error) {
    throw new SymphonyError(
      'agent_startup_failed',
      `thread/start failed: ${threadResp.error.message}`,
    )
  }
  threadId = (threadResp.result as { threadId?: string })?.threadId ?? null

  log(`Session started: sessionId=${sessionId}, threadId=${threadId}, pid=${proc.pid}`)

  // ── Public API ───────────────────────────────────────────────────────────────
  async function sendTurn(prompt: string): Promise<TurnResult> {
    const turnReqId = nextId()
    const turnReq = {
      jsonrpc: '2.0' as const,
      id: turnReqId,
      method: 'turn/start',
      params: {
        threadId: threadId!,
        content: prompt,
      },
    }

    return new Promise<TurnResult>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new SymphonyError('agent_turn_timeout', 'Turn timed out')),
        config.turn_timeout_ms,
      )

      let turnId = ''

      function handler(ev: AgentEvent) {
        // Update turnId on first turn event
        if (ev.turn_id && !turnId) turnId = ev.turn_id

        if (ev.type === 'turn_input_required') {
          clearTimeout(timer)
          events.off('event', handler)
          reject(
            new SymphonyError(
              'agent_input_required',
              `Agent requested user input: ${ev.message}`,
            ),
          )
          return
        }

        if (ev.type === 'turn_completed') {
          clearTimeout(timer)
          events.off('event', handler)
          resolve({
            success: true,
            threadId: ev.thread_id ?? threadId ?? '',
            turnId: ev.turn_id ?? '',
            inputTokens: ev.input_tokens ?? 0,
            outputTokens: ev.output_tokens ?? 0,
            totalTokens: ev.total_tokens ?? 0,
            message: ev.message ?? '',
          })
          return
        }

        if (
          ev.type === 'turn_failed' ||
          ev.type === 'turn_cancelled' ||
          ev.type === 'turn_ended_with_error'
        ) {
          clearTimeout(timer)
          events.off('event', handler)
          resolve({
            success: false,
            threadId: ev.thread_id ?? threadId ?? '',
            turnId: ev.turn_id ?? '',
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            message: ev.message ?? '',
            error: ev.message ?? ev.type,
          })
        }
      }

      events.on('event', handler)

      // Send the turn/start
      sendRequest(turnReq).catch((err) => {
        clearTimeout(timer)
        events.off('event', handler)
        reject(err)
      })
    })
  }

  function close() {
    try {
      proc.stdin.end()
      proc.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  return {
    pid: proc.pid ?? 0,
    get sessionId() { return sessionId },
    get threadId() { return threadId },
    events,
    sendTurn,
    close,
  }
}

export type { ChildProcess }
