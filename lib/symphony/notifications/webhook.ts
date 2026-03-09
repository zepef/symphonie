import { TokenTotals } from '../types'

const log = (...args: unknown[]) => console.log('[symphony:webhook]', ...args)

export interface WebhookPayload {
  event: 'completed' | 'failed' | 'retry_queued'
  identifier: string
  title: string
  attempt: number
  tokens?: TokenTotals
  error?: string
  timestamp: string
}

export function fireWebhook(url: string, payload: WebhookPayload): void {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => { if (!r.ok) log(`Webhook returned ${r.status}`) })
    .catch((err) => log(`Webhook failed: ${(err as Error).message}`))
}
