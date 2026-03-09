import { EventEmitter } from 'events'
import { AgentEvent, ResolvedConfig, SymphonyError } from '../types'
import { JsonRpcRequest } from './protocol'
import { spawnSubprocess } from './subprocess'
import { createRpcTransport } from './rpc-transport'
import { createEventParser } from './event-parser'

const log = (...args: unknown[]) => console.log('[symphony:agent]', ...args)

export interface AgentSession {
  pid: number
  sessionId: string | null
  threadId: string | null
  events: EventEmitter
  sendTurn(prompt: string): Promise<TurnResult>
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

function waitForEvent(events: EventEmitter, type: string, timeoutMs: number): Promise<AgentEvent> {
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
          reject(new SymphonyError('agent_startup_failed', `Agent startup failed: ${ev.message}`))
        } else {
          resolve(ev)
        }
      }
    }
    events.on('event', handler)
  })
}

export async function startSession(
  config: ResolvedConfig,
  workspacePath: string,
): Promise<AgentSession> {
  const proc = spawnSubprocess(config.codex_command, workspacePath)
  const agentEvents = new EventEmitter()
  const transport = createRpcTransport((line) => proc.stdin.write(line))
  const { handleNotification } = createEventParser(agentEvents, config, transport.sendRaw)

  proc.events.on('line', (line: string) => {
    if (!line.trim()) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      agentEvents.emit('event', { type: 'malformed', message: line } as AgentEvent)
      return
    }
    if (!transport.handleResponseLine(msg)) {
      handleNotification(msg)
    }
  })

  proc.events.on('close', () => {
    agentEvents.emit('close')
    transport.rejectAll(new Error('Process closed'))
  })

  let sessionId: string | null = null
  let threadId: string | null = null

  // ── Handshake ─────────────────────────────────────────────────────────────
  // 1. initialize
  const initReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: transport.nextId(),
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', clientInfo: { name: 'symphony', version: '1.0.0' } },
  }
  const initResp = await Promise.race([
    transport.sendRequest(initReq),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('initialize response timeout')), config.read_timeout_ms),
    ),
  ])
  if (initResp.error) {
    throw new SymphonyError('agent_startup_failed', `initialize failed: ${initResp.error.message}`)
  }

  // 2. initialized notification
  transport.sendRaw({ jsonrpc: '2.0', method: 'initialized' })

  // 3. Wait for session_started
  const sessionEv = await Promise.race([
    waitForEvent(agentEvents, 'session_started', config.read_timeout_ms),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('session_started timeout')), config.read_timeout_ms),
    ),
  ])
  sessionId = sessionEv.session_id ?? null

  // 4. thread/start
  const threadReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: transport.nextId(),
    method: 'thread/start',
    params: {},
  }
  const threadResp = await Promise.race([
    transport.sendRequest(threadReq),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('thread/start response timeout')), config.read_timeout_ms),
    ),
  ])
  if (threadResp.error) {
    throw new SymphonyError('agent_startup_failed', `thread/start failed: ${threadResp.error.message}`)
  }
  threadId = (threadResp.result as { threadId?: string })?.threadId ?? null
  if (!threadId) {
    proc.kill()
    throw new SymphonyError('agent_startup_failed', 'thread/start response contained no threadId')
  }

  log(`Session started: sessionId=${sessionId}, threadId=${threadId}, pid=${proc.pid}`)

  // ── Public API ─────────────────────────────────────────────────────────────
  function sendTurn(prompt: string): Promise<TurnResult> {
    const turnReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: transport.nextId(),
      method: 'turn/start',
      params: { threadId: threadId!, content: prompt },
    }

    return new Promise<TurnResult>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new SymphonyError('agent_turn_timeout', 'Turn timed out')),
        config.turn_timeout_ms,
      )

      let turnId = ''

      function handler(ev: AgentEvent) {
        if (ev.turn_id && !turnId) turnId = ev.turn_id

        if (ev.type === 'turn_input_required') {
          clearTimeout(timer)
          agentEvents.off('event', handler)
          reject(new SymphonyError('agent_input_required', `Agent requested user input: ${ev.message}`))
          return
        }

        if (ev.type === 'turn_completed') {
          clearTimeout(timer)
          agentEvents.off('event', handler)
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

        if (ev.type === 'turn_failed' || ev.type === 'turn_cancelled' || ev.type === 'turn_ended_with_error') {
          clearTimeout(timer)
          agentEvents.off('event', handler)
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

      agentEvents.on('event', handler)

      transport.sendRequest(turnReq).catch((err) => {
        clearTimeout(timer)
        agentEvents.off('event', handler)
        reject(err)
      })
    })
  }

  function close() {
    proc.kill()
  }

  return {
    pid: proc.pid,
    get sessionId() { return sessionId },
    get threadId() { return threadId },
    events: agentEvents,
    sendTurn,
    close,
  }
}
