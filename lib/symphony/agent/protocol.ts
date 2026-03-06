// JSON-RPC message types for the Codex app-server protocol

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

// Outbound requests
export interface InitializeRequest extends JsonRpcRequest {
  method: 'initialize'
  params: {
    protocolVersion: string
    clientInfo: { name: string; version: string }
  }
}

export interface ThreadStartRequest extends JsonRpcRequest {
  method: 'thread/start'
  params?: Record<string, unknown>
}

export interface TurnStartRequest extends JsonRpcRequest {
  method: 'turn/start'
  params: {
    threadId: string
    content: string
  }
}

// Inbound notifications (events from the agent)
export type AgentNotificationMethod =
  | 'session_started'
  | 'startup_failed'
  | 'turn_completed'
  | 'turn_failed'
  | 'turn_cancelled'
  | 'turn_ended_with_error'
  | 'turn_input_required'
  | 'approval_auto_approved'
  | 'unsupported_tool_call'
  | 'notification'

export interface SessionStartedParams {
  sessionId: string
}

export interface StartupFailedParams {
  error: string
}

export interface TurnCompletedParams {
  threadId: string
  turnId: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  message?: string
}

export interface TurnFailedParams {
  threadId: string
  turnId: string
  error?: string
}

export interface TurnInputRequiredParams {
  threadId: string
  turnId: string
  prompt: string
}

export interface UnsupportedToolCallParams {
  toolName: string
  message?: string
}
