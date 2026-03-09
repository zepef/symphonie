import * as path from 'path'
import { FSWatcher } from 'chokidar'
import {
  Issue,
  IssueDetail,
  RefreshResponse,
  ResolvedConfig,
  RunningEntry,
  StateResponse,
} from '../types'
import { parseWorkflowFile } from '../config/workflow-parser'
import { resolveConfig } from '../config/config-layer'
import { watchWorkflowFile } from '../config/watcher'
import { removeWorkspace } from '../workspace/manager'
import { OrchestratorState } from './state'
import { tick } from './poll-loop'
import { scheduleRetry } from './retry'
import { runWorker } from './worker'
import { HistoryStore } from '../persistence/history-store'
import { fireWebhook } from '../notifications/webhook'

const log = (...args: unknown[]) => console.log('[symphony:orchestrator]', ...args)

export class Orchestrator {
  private state = new OrchestratorState()
  private config: ResolvedConfig | null = null
  private workflowPath: string | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private watcher: FSWatcher | null = null
  private refreshRequested = false
  private issueCache = new Map<string, Issue>()
  private historyStore: HistoryStore | null = null

  async start(workflowPath?: string): Promise<void> {
    this.workflowPath =
      workflowPath ??
      path.resolve(process.cwd(), 'WORKFLOW.md')

    this.state.workflowPath = this.workflowPath
    this.state.running_status = 'running'

    log(`Starting with workflow: ${this.workflowPath}`)

    this.loadConfig()

    // Initialise history store and seed in-memory state from persisted records
    if (this.config) {
      this.historyStore = new HistoryStore(this.config.workspace_root)
      try {
        const restored = await this.historyStore.loadAll()
        for (const id of restored.completed) this.state.completed.add(id)
        for (const [id, entries] of restored.issueHistory) this.state.issueHistory.set(id, entries)
        this.state.tokenTotals = restored.tokenTotals
        log(`Restored ${restored.completed_count} completed issues from history`)
      } catch (err) {
        log(`Failed to restore history: ${(err as Error).message}`)
      }
    }

    // Start file watcher for hot reload
    try {
      this.watcher = watchWorkflowFile(this.workflowPath, () => {
        log('WORKFLOW.md changed, reloading config')
        this.loadConfig()
      })
    } catch (err) {
      log(`Failed to watch ${this.workflowPath}: ${(err as Error).message}`)
    }

    // Initial poll
    this.schedulePoll(0)
  }

  stop(): void {
    log('Stopping orchestrator')
    this.state.running_status = 'stopped'

    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    if (this.watcher) {
      this.watcher.close().catch(() => {})
      this.watcher = null
    }

    for (const issueId of [...this.state.retryAttempts.keys()]) {
      this.state.cancelRetry(issueId)
    }

    for (const [, entry] of this.state.running) {
      entry.abort.abort()
    }
  }

  getState(): StateResponse {
    const s = this.state

    const running = [...s.running.values()].map((e) => this.serializeRunning(e))
    const retrying = [...s.retryAttempts.values()].map((r) => ({
      identifier: r.identifier,
      attempt: r.attempt,
      error: r.error,
      retry_at: r.retry_at.toISOString(),
    }))

    return {
      status: s.running_status,
      workflow_path: s.workflowPath,
      running,
      retrying,
      completed_count: s.completed.size,
      token_totals: { ...s.tokenTotals },
      config_valid: s.configValid,
      config_error: s.configError,
      last_poll_at: s.lastPollAt?.toISOString() ?? null,
      uptime_ms: Date.now() - s.startedAt.getTime(),
    }
  }

  getIssueDetail(identifier: string): IssueDetail | null {
    const s = this.state

    let runningEntry: ReturnType<OrchestratorState['getRunningForIssue']> = undefined
    let foundId: string | null = null
    for (const [id, entry] of s.running) {
      if (entry.issue.identifier === identifier) {
        runningEntry = entry
        foundId = id
        break
      }
    }

    let retryEntry: ReturnType<OrchestratorState['getRetryForIssue']> = undefined
    for (const [, entry] of s.retryAttempts) {
      if (entry.identifier === identifier) {
        retryEntry = entry
        break
      }
    }

    let completedId: string | null = null
    for (const id of s.completed) {
      const cached = this.issueCache.get(id)
      if (cached?.identifier === identifier) {
        completedId = id
        break
      }
    }

    let historyId: string | null = foundId ?? completedId
    if (!historyId) {
      for (const [id] of s.issueHistory) {
        const cached = this.issueCache.get(id)
        if (cached?.identifier === identifier) {
          historyId = id
          break
        }
      }
    }

    const hasAny = runningEntry || retryEntry || completedId || historyId
    if (!hasAny) return null

    const issue = runningEntry?.issue ?? this.issueCache.get(historyId ?? '')
    if (!issue) return null

    return {
      identifier: issue.identifier,
      title: issue.title,
      state: issue.state,
      running: runningEntry ? this.serializeRunning(runningEntry) : null,
      retrying: retryEntry
        ? {
            identifier: retryEntry.identifier,
            attempt: retryEntry.attempt,
            error: retryEntry.error,
            retry_at: retryEntry.retry_at.toISOString(),
          }
        : null,
      completed: s.completed.has(issue.id),
      history: s.issueHistory.get(issue.id) ?? [],
    }
  }

  requestRefresh(): RefreshResponse {
    this.refreshRequested = true
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.schedulePoll(0)
    return { queued: true, message: 'Refresh queued' }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private loadConfig() {
    if (!this.workflowPath) return
    try {
      const def = parseWorkflowFile(this.workflowPath)
      this.config = resolveConfig(def)
      this.state.configValid = true
      this.state.configError = null
      log('Config loaded successfully')
    } catch (err) {
      this.state.configValid = false
      this.state.configError = (err as Error).message
      log(`Config load failed: ${(err as Error).message}`)
    }
  }

  private schedulePoll(delayMs: number) {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => this.runTick(), delayMs)
  }

  private async runTick() {
    this.pollTimer = null

    if (this.state.running_status !== 'running') return
    if (!this.config) {
      this.schedulePoll(30_000)
      return
    }

    const config = this.config

    try {
      await tick(this.state, config, {
        killWorker: (issueId, reason, cleanup) => {
          this.killWorker(issueId, reason, cleanup)
        },
        queueRetryForIssue: (issueId, reason) => {
          const entry = this.state.running.get(issueId)
          if (!entry) return
          const attempt = entry.attempt + 1
          if (attempt > config.max_retries) {
            log(`Max retries exceeded for ${entry.issue.identifier}, giving up`)
            this.state.removeRunning(issueId)
            this.state.unclaim(issueId)
            return
          }
          scheduleRetry(issueId, entry.issue.identifier, attempt, reason, this.state, config, (id) => {
            const issue = this.issueCache.get(id)
            if (!issue) {
              log(`No cached issue for ${id}, skipping retry dispatch`)
              return
            }
            this.dispatchWorker(issue, attempt)
          })
        },
        dispatchIssue: (issue, attempt) => {
          this.issueCache.set(issue.id, issue)
          this.dispatchWorker(issue, attempt)
        },
        onError: (error) => {
          log(`Dispatch error: ${error}`)
        },
      })
    } catch (err) {
      log(`Tick error: ${(err as Error).message}`)
    }

    if (this.state.running_status === 'running') {
      this.schedulePoll(this.config?.poll_interval_ms ?? 60_000)
    }
  }

  private killWorker(issueId: string, reason: string, cleanup: boolean) {
    const entry = this.state.running.get(issueId)
    if (!entry) return
    log(`Killing worker for ${entry.issue.identifier}: ${reason}`)
    entry.abort.abort()
    this.state.removeRunning(issueId)

    if (cleanup && this.config) {
      removeWorkspace(entry.workspace_path, this.config).catch((err) => {
        log(`Failed to remove workspace: ${(err as Error).message}`)
      })
    }
  }

  private dispatchWorker(issue: Issue, attempt: number) {
    const config = this.config
    if (!config) return

    const abort = new AbortController()

    void runWorker(issue, attempt, config, this.state, {
      onSessionUpdate: () => {},
      onCompleted: (issueId, tokens) => {
        log(`Worker completed for ${issue.identifier}`)
        this.state.completed.add(issueId)
        this.state.unclaim(issueId)
        this.state.addTokens(tokens.input, tokens.output, tokens.total)

        if (config.notifications_webhook_url && config.notifications_on_complete) {
          fireWebhook(config.notifications_webhook_url, {
            event: 'completed',
            identifier: issue.identifier,
            title: issue.title,
            attempt,
            tokens: {
              input_tokens: tokens.input,
              output_tokens: tokens.output,
              total_tokens: tokens.total,
            },
            timestamp: new Date().toISOString(),
          })
        }
        // No continuation retry — the poll loop will re-dispatch if the issue
        // remains in a dispatch state on the next tick.
      },
      onFailed: (issueId, error, currentAttempt) => {
        log(`Worker failed for ${issue.identifier}: ${error}`)
        this.state.unclaim(issueId)

        if (config.notifications_webhook_url && config.notifications_on_failure) {
          fireWebhook(config.notifications_webhook_url, {
            event: 'failed',
            identifier: issue.identifier,
            title: issue.title,
            attempt: currentAttempt,
            error,
            timestamp: new Date().toISOString(),
          })
        }

        const nextAttempt = currentAttempt + 1
        if (nextAttempt > config.max_retries) {
          log(`Max retries exceeded for ${issue.identifier}`)
          return
        }

        if (config.notifications_webhook_url && config.notifications_on_retry) {
          fireWebhook(config.notifications_webhook_url, {
            event: 'retry_queued',
            identifier: issue.identifier,
            title: issue.title,
            attempt: nextAttempt,
            error,
            timestamp: new Date().toISOString(),
          })
        }

        scheduleRetry(issueId, issue.identifier, nextAttempt, error, this.state, config, (id) => {
          const cachedIssue = this.issueCache.get(id)
          if (!cachedIssue) {
            log(`No cached issue for ${id}, skipping retry dispatch`)
            return
          }
          this.state.claim(id)
          this.dispatchWorker(cachedIssue, nextAttempt)
        })
      },
      persistHistory: (record) => {
        void this.historyStore?.append(record)
      },
    }, abort)
  }

  private serializeRunning(e: RunningEntry) {
    return {
      identifier: e.issue.identifier,
      title: e.issue.title,
      state: e.issue.state,
      workspace_path: e.workspace_path,
      started_at: e.started_at.toISOString(),
      attempt: e.attempt,
      session: {
        session_id: e.session.session_id,
        thread_id: e.session.thread_id,
        turn_id: e.session.turn_id,
        pid: e.session.codex_app_server_pid,
        last_event: e.session.last_codex_event,
        last_timestamp: e.session.last_codex_timestamp?.toISOString() ?? null,
        last_message: e.session.last_codex_message,
        input_tokens: e.session.codex_input_tokens,
        output_tokens: e.session.codex_output_tokens,
        total_tokens: e.session.codex_total_tokens,
        turn_count: e.session.turn_count,
      },
    }
  }
}
