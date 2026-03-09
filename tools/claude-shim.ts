#!/usr/bin/env node
/**
 * tools/claude-shim.ts
 *
 * Symphony JSON-RPC 2.0 adapter for the `claude` CLI.
 *
 * Speaks the Symphony agent protocol on stdio, drives `claude --print
 * --output-format stream-json` for each turn, and uses `--resume <sessionId>`
 * to maintain conversation context across turns.
 *
 * Usage in WORKFLOW.md:
 *   codex:
 *     command: npx tsx /absolute/path/to/tools/claude-shim.ts
 *
 * Env vars:
 *   CLAUDE_MODEL          — model to pass (default: claude-sonnet-4-6)
 *   CLAUDE_ALLOWED_TOOLS  — comma-separated allowed tools (e.g. "Bash,Read,Write")
 */

import { createInterface } from 'readline'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'

// ── Wire types (subset of Symphony's protocol) ─────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

// ── Output helpers ─────────────────────────────────────────────────────────

function send(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function respond(id: string | number, result: unknown) {
  send({ jsonrpc: '2.0', id, result })
}

function respondError(id: string | number, code: number, message: string) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function notify(method: string, params: unknown) {
  send({ jsonrpc: '2.0', method, params })
}

const log = (...args: unknown[]) =>
  process.stderr.write('[claude-shim] ' + args.join(' ') + '\n')

// ── Session state ──────────────────────────────────────────────────────────

const SESSION_ID = randomUUID()  // shim's own session identifier
const THREAD_ID = randomUUID()   // single thread for this process lifetime
let claudeSessionId: string | null = null  // claude's session id for --resume

// ── Claude runner ──────────────────────────────────────────────────────────

interface ClaudeResult {
  sessionId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  text: string
  isError: boolean
}

function runClaude(prompt: string): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'

    const args: string[] = [
      '--print',
      '--output-format', 'stream-json',
      '--model', model,
    ]

    if (claudeSessionId) {
      args.push('--resume', claudeSessionId)
    }

    const allowedTools = process.env.CLAUDE_ALLOWED_TOOLS
    if (allowedTools) {
      for (const tool of allowedTools.split(',').map(t => t.trim()).filter(Boolean)) {
        args.push('--allowedTools', tool)
      }
    }

    log(`Spawning: claude ${args.join(' ')}`)

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    // Write the prompt to claude's stdin then close it
    child.stdin.write(prompt + '\n')
    child.stdin.end()

    let resultRecord: ClaudeResult | null = null
    let buf = ''

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }

        // The final "result" message contains token counts and the full response
        if (msg.type === 'result') {
          const usage = (msg.usage ?? {}) as Record<string, number>
          const inputTokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0)
          const outputTokens = usage.output_tokens ?? 0

          resultRecord = {
            sessionId: (msg.session_id as string) ?? '',
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            text: (msg.result as string) ?? '',
            isError: !!(msg.is_error),
          }
        }
      }
    })

    child.on('close', (code) => {
      if (resultRecord) {
        resolve(resultRecord)
      } else if (code !== 0) {
        reject(new Error(`claude exited with code ${code}`))
      } else {
        // Exited 0 but no result record — treat as empty success
        resolve({
          sessionId: claudeSessionId ?? '',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          text: '',
          isError: false,
        })
      }
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`))
    })
  })
}

// ── Request handler ────────────────────────────────────────────────────────

async function handleRequest(req: JsonRpcRequest) {
  switch (req.method) {
    case 'initialize': {
      respond(req.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'claude-shim', version: '1.0.0' },
        capabilities: {},
      })
      break
    }

    case 'thread/start': {
      respond(req.id, { threadId: THREAD_ID })
      break
    }

    case 'turn/start': {
      const params = req.params as { threadId?: string; content?: string }
      const prompt = params?.content ?? ''
      const turnId = randomUUID()

      // Acknowledge immediately — Symphony is waiting for the RPC response
      respond(req.id, { turnId })

      try {
        const result = await runClaude(prompt)

        // Persist claude's session id for --resume on subsequent turns
        if (result.sessionId) {
          claudeSessionId = result.sessionId
        }

        if (result.isError) {
          notify('turn_failed', {
            threadId: THREAD_ID,
            turnId,
            error: result.text || 'claude reported an error',
          })
        } else {
          notify('turn_completed', {
            threadId: THREAD_ID,
            turnId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.totalTokens,
            message: result.text,
          })
        }
      } catch (err) {
        notify('turn_failed', {
          threadId: THREAD_ID,
          turnId,
          error: (err as Error).message,
        })
      }
      break
    }

    default:
      respondError(req.id, -32601, `Method not found: ${req.method}`)
  }
}

// ── Notification handler ───────────────────────────────────────────────────

function handleNotification(notif: JsonRpcNotification) {
  if (notif.method === 'initialized') {
    // Symphony is ready — announce ourselves
    notify('session_started', { sessionId: SESSION_ID })
  }
  // Other inbound notifications (tool_result, etc.) are ignored by the shim
}

// ── Main loop ──────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  if (!line.trim()) return
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  if ('id' in msg) {
    handleRequest(msg as unknown as JsonRpcRequest).catch((err) => {
      log('Unhandled error in handleRequest:', err)
    })
  } else {
    handleNotification(msg as unknown as JsonRpcNotification)
  }
})

rl.on('close', () => {
  process.exit(0)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
