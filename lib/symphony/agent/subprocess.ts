import { spawn } from 'child_process'
import { EventEmitter } from 'events'

const log = (...args: unknown[]) => console.log('[symphony:agent]', ...args)

const MAX_LINE_BYTES = 10 * 1024 * 1024 // 10 MB

export interface Subprocess {
  pid: number
  stdin: NodeJS.WritableStream
  /** Emits 'line' (string) and 'close' () */
  events: EventEmitter
  kill(): void
}

export function spawnSubprocess(command: string, cwd: string): Subprocess {
  const proc = spawn('bash', ['-lc', command], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const events = new EventEmitter()
  let lineBuffer = ''

  proc.stderr?.on('data', (d: Buffer) => {
    log('stderr:', d.toString().trim())
  })

  proc.stdout?.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString('utf-8')
    if (lineBuffer.length > MAX_LINE_BYTES) {
      lineBuffer = lineBuffer.slice(-MAX_LINE_BYTES)
    }
    let newlineIdx: number
    while ((newlineIdx = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, newlineIdx)
      lineBuffer = lineBuffer.slice(newlineIdx + 1)
      events.emit('line', line)
    }
  })

  proc.on('close', () => {
    events.emit('close')
  })

  return {
    pid: proc.pid ?? 0,
    stdin: proc.stdin!,
    events,
    kill() {
      try {
        proc.stdin!.end()
        proc.kill('SIGTERM')
      } catch {
        // ignore
      }
    },
  }
}
