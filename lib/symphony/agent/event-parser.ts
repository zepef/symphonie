import { EventEmitter } from 'events'
import { AgentEvent, ResolvedConfig } from '../types'
import {
  JsonRpcNotification,
  SessionStartedParams,
  TurnCompletedParams,
  TurnFailedParams,
  TurnInputRequiredParams,
  UnsupportedToolCallParams,
} from './protocol'
import { executeLinearGraphQL } from '../tracker/linear'

export function createEventParser(
  agentEvents: EventEmitter,
  config: ResolvedConfig,
  sendRaw: (msg: JsonRpcNotification) => void,
): { handleNotification: (msg: Record<string, unknown>) => void } {

  async function handleLinearTool(
    p: UnsupportedToolCallParams,
    params: Record<string, unknown>,
  ) {
    const input = params?.input as { query?: string; variables?: Record<string, unknown> } | undefined
    try {
      const data = await executeLinearGraphQL(
        config.tracker_api_key,
        input?.query ?? '',
        input?.variables ?? {},
      )
      sendRaw({
        jsonrpc: '2.0',
        method: 'tool_result',
        params: { toolName: p.toolName, success: true, data },
      })
    } catch (err) {
      sendRaw({
        jsonrpc: '2.0',
        method: 'tool_result',
        params: { toolName: p.toolName, success: false, error: (err as Error).message },
      })
    }
  }

  function handleNotification(msg: Record<string, unknown>) {
    const notif = msg as unknown as JsonRpcNotification
    const method = notif.method as string
    const params = notif.params as Record<string, unknown> | undefined

    switch (method) {
      case 'session_started': {
        const p = params as unknown as SessionStartedParams
        agentEvents.emit('event', { type: 'session_started', session_id: p.sessionId } as AgentEvent)
        break
      }
      case 'startup_failed': {
        agentEvents.emit('event', {
          type: 'startup_failed',
          message: (params as { error?: string })?.error,
        } as AgentEvent)
        break
      }
      case 'turn_completed': {
        const p = params as unknown as TurnCompletedParams
        agentEvents.emit('event', {
          type: 'turn_completed',
          thread_id: p.threadId,
          turn_id: p.turnId,
          input_tokens: p.inputTokens ?? 0,
          output_tokens: p.outputTokens ?? 0,
          total_tokens: p.totalTokens ?? 0,
          message: p.message ?? '',
        } as AgentEvent)
        break
      }
      case 'turn_failed': {
        const p = params as unknown as TurnFailedParams
        agentEvents.emit('event', {
          type: 'turn_failed',
          thread_id: p.threadId,
          turn_id: p.turnId,
          message: p.error,
        } as AgentEvent)
        break
      }
      case 'turn_cancelled': {
        const p = params as unknown as TurnFailedParams
        agentEvents.emit('event', {
          type: 'turn_cancelled',
          thread_id: p.threadId,
          turn_id: p.turnId,
        } as AgentEvent)
        break
      }
      case 'turn_ended_with_error': {
        agentEvents.emit('event', { type: 'turn_ended_with_error', data: params } as AgentEvent)
        break
      }
      case 'turn_input_required': {
        const p = params as unknown as TurnInputRequiredParams
        agentEvents.emit('event', {
          type: 'turn_input_required',
          thread_id: p.threadId,
          turn_id: p.turnId,
          message: p.prompt,
        } as AgentEvent)
        break
      }
      case 'approval_auto_approved': {
        agentEvents.emit('event', { type: 'approval_auto_approved', data: params } as AgentEvent)
        break
      }
      case 'unsupported_tool_call': {
        const p = params as unknown as UnsupportedToolCallParams
        if (p.toolName === 'linear_graphql' && config.tracker_kind === 'linear' && config.tracker_api_key) {
          void handleLinearTool(p, params as Record<string, unknown>)
        } else {
          agentEvents.emit('event', {
            type: 'unsupported_tool_call',
            tool_name: p.toolName,
            message: p.message,
          } as AgentEvent)
          sendRaw({
            jsonrpc: '2.0',
            method: 'tool_result',
            params: { toolName: p.toolName, success: false, error: `Tool ${p.toolName} is not supported` },
          })
        }
        break
      }
      default: {
        agentEvents.emit('event', { type: 'other_message', data: msg } as AgentEvent)
        break
      }
    }
  }

  return { handleNotification }
}
