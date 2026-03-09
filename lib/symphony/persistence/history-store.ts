import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { IssueHistoryEntry, TokenTotals } from '../types'

const log = (...args: unknown[]) => console.log('[symphony:history]', ...args)

export interface HistoryRecord {
  issue_id: string
  identifier: string
  outcome: 'completed' | 'failed' | 'retried'
  attempt: number
  started_at: string
  ended_at: string
  tokens?: TokenTotals
  error?: string
  after_run_hook_error?: string
  written_at: string
}

export interface RestoredState {
  completed: Set<string>
  issueHistory: Map<string, IssueHistoryEntry[]>
  tokenTotals: TokenTotals
  completed_count: number
}

export class HistoryStore {
  private filePath: string

  constructor(workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, '.symphony-history.jsonl')
  }

  async append(record: HistoryRecord): Promise<void> {
    try {
      const line = JSON.stringify(record) + '\n'
      await fs.appendFile(this.filePath, line, 'utf-8')
    } catch (err) {
      log(`Failed to append history record: ${(err as Error).message}`)
    }
  }

  async loadAll(): Promise<RestoredState> {
    const completed = new Set<string>()
    const issueHistory = new Map<string, IssueHistoryEntry[]>()
    const tokenTotals: TokenTotals = { input_tokens: 0, output_tokens: 0, total_tokens: 0 }

    try {
      const content = await fs.readFile(this.filePath, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim())
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as HistoryRecord

          if (record.outcome === 'completed') {
            completed.add(record.issue_id)
          }

          const entry: IssueHistoryEntry = {
            attempt: record.attempt,
            started_at: record.started_at,
            ended_at: record.ended_at,
            outcome: record.outcome,
            error: record.error,
            tokens: record.tokens,
            after_run_hook_error: record.after_run_hook_error,
          }
          const existing = issueHistory.get(record.issue_id) ?? []
          existing.push(entry)
          issueHistory.set(record.issue_id, existing)

          if (record.tokens) {
            tokenTotals.input_tokens += record.tokens.input_tokens
            tokenTotals.output_tokens += record.tokens.output_tokens
            tokenTotals.total_tokens += record.tokens.total_tokens
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        log(`Failed to load history: ${(err as Error).message}`)
      }
    }

    return { completed, issueHistory, tokenTotals, completed_count: completed.size }
  }
}
