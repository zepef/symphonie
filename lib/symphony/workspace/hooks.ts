import { spawn } from 'child_process'
import { SymphonyError } from '../types'

const log = (...args: unknown[]) => console.log('[symphony:hooks]', ...args)

export async function runHook(
  script: string,
  cwd: string,
  timeoutMs: number,
  hookName: string,
): Promise<void> {
  log(`Running hook ${hookName} in ${cwd}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('bash', ['-lc', script], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: controller.signal,
    })

    proc.stdout?.on('data', (d: Buffer) =>
      log(`${hookName} stdout:`, d.toString().trim()),
    )
    proc.stderr?.on('data', (d: Buffer) =>
      log(`${hookName} stderr:`, d.toString().trim()),
    )

    proc.on('error', (err: Error & { code?: string }) => {
      clearTimeout(timer)
      if (err.code === 'ERR_ABORT') {
        reject(
          new SymphonyError(
            'hook_fatal_failure',
            `Hook ${hookName} timed out after ${timeoutMs}ms`,
          ),
        )
      } else {
        reject(
          new SymphonyError(
            'hook_fatal_failure',
            `Hook ${hookName} failed to start: ${err.message}`,
            err,
          ),
        )
      }
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
      } else {
        reject(
          new SymphonyError(
            'hook_fatal_failure',
            `Hook ${hookName} exited with code ${code}`,
          ),
        )
      }
    })
  })
}
