import { AgentEvent, Issue, ResolvedConfig, RunningEntry, SymphonyError } from '../types'
import { prepareWorkspace } from '../workspace/manager'
import { runHook } from '../workspace/hooks'
import { renderPrompt } from '../prompt/renderer'
import { startSession } from '../agent/client'
import { OrchestratorState } from './state'
import { HistoryRecord } from '../persistence/history-store'

const log = (...args: unknown[]) => console.log('[symphony:worker]', ...args)

const HOOK_TIMEOUT_MS = 60_000

export interface WorkerCallbacks {
  onSessionUpdate: (entry: RunningEntry) => void
  onCompleted: (issueId: string, tokens: { input: number; output: number; total: number }) => void
  onFailed: (issueId: string, error: string, attempt: number) => void
  persistHistory?: (record: HistoryRecord) => void
}

export async function runWorker(
  issue: Issue,
  attempt: number,
  config: ResolvedConfig,
  state: OrchestratorState,
  callbacks: WorkerCallbacks,
  abortController: AbortController,
): Promise<void> {
  const issueId = issue.id
  let workspacePath = ''
  let agentSession: Awaited<ReturnType<typeof startSession>> | null = null
  const startedAt = new Date()

  try {
    // ── Phase 1: Prepare workspace ─────────────────────────────────────────
    log(`[${issue.identifier}] Preparing workspace (attempt ${attempt})`)
    const workspace = await prepareWorkspace(issue, config)
    workspacePath = workspace.path

    if (abortController.signal.aborted) return

    // ── Phase 2: before_run hook ───────────────────────────────────────────
    if (config.hooks_before_run) {
      log(`[${issue.identifier}] Running before_run hook`)
      await runHook(config.hooks_before_run, workspacePath, HOOK_TIMEOUT_MS, 'before_run')
    }

    if (abortController.signal.aborted) return

    // ── Phase 3: Build prompt ──────────────────────────────────────────────
    log(`[${issue.identifier}] Rendering prompt`)
    const prompt = await renderPrompt(config.prompt_template, { issue, attempt })

    if (abortController.signal.aborted) return

    // ── Phase 4: Launch agent ──────────────────────────────────────────────
    log(`[${issue.identifier}] Starting agent session`)
    agentSession = await startSession(config, workspacePath)

    // Create the running entry
    const session = state.makeLiveSession(agentSession.pid)
    session.session_id = agentSession.sessionId
    session.thread_id = agentSession.threadId

    const entry: RunningEntry = {
      issue,
      workspace_path: workspacePath,
      started_at: startedAt,
      attempt,
      abort: abortController,
      session,
    }
    state.setRunning(issueId, entry)
    callbacks.onSessionUpdate(entry)

    if (abortController.signal.aborted) {
      agentSession.close()
      return
    }

    // ── Phase 5: Stream turns ──────────────────────────────────────────────
    // Accumulated totals — authoritative source is turn results only.
    // Per-event tokens are used only for live UI display, not final accounting.
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalTotalTokens = 0
    let lastReportedInput = 0
    let lastReportedOutput = 0
    let lastReportedTotal = 0

    // Subscribe to events for live session state (UI display only)
    agentSession.events.on('event', (ev: AgentEvent) => {
      const runEntry = state.getRunningForIssue(issueId)
      if (!runEntry) return

      runEntry.session.last_codex_event = ev.type
      runEntry.session.last_codex_timestamp = new Date()

      if (ev.session_id) runEntry.session.session_id = ev.session_id
      if (ev.thread_id) runEntry.session.thread_id = ev.thread_id
      if (ev.turn_id) runEntry.session.turn_id = ev.turn_id
      if (ev.message) runEntry.session.last_codex_message = ev.message

      // Live token display only — not used for final accounting to avoid double-counting
      if (ev.total_tokens !== undefined && ev.total_tokens > 0) {
        runEntry.session.codex_input_tokens = ev.input_tokens ?? runEntry.session.codex_input_tokens
        runEntry.session.codex_output_tokens = ev.output_tokens ?? runEntry.session.codex_output_tokens
        runEntry.session.codex_total_tokens = ev.total_tokens
      }
    })

    // Run turns up to max_turns
    let turnPrompt = prompt
    let success = false

    for (let turn = 0; turn < config.max_turns; turn++) {
      if (abortController.signal.aborted) break

      log(`[${issue.identifier}] Starting turn ${turn + 1}/${config.max_turns}`)
      const runEntry = state.getRunningForIssue(issueId)
      if (runEntry) runEntry.session.turn_count = turn + 1

      const result = await agentSession.sendTurn(turnPrompt)

      if (!result.success) {
        throw new SymphonyError(
          'agent_startup_failed',
          result.error ?? 'Turn failed',
        )
      }

      // Accumulate tokens from turn result (sole authoritative source)
      if (result.totalTokens > 0) {
        const deltaTotal = result.totalTokens - lastReportedTotal
        if (deltaTotal > 0) {
          totalInputTokens += Math.max(result.inputTokens - lastReportedInput, 0)
          totalOutputTokens += Math.max(result.outputTokens - lastReportedOutput, 0)
          totalTotalTokens += deltaTotal
          lastReportedInput = result.inputTokens
          lastReportedOutput = result.outputTokens
          lastReportedTotal = result.totalTokens
        }

        // Sync accurate totals to live session display
        const runEntry = state.getRunningForIssue(issueId)
        if (runEntry) {
          runEntry.session.codex_input_tokens = totalInputTokens
          runEntry.session.codex_output_tokens = totalOutputTokens
          runEntry.session.codex_total_tokens = totalTotalTokens
        }
      }

      if (turn + 1 >= config.max_turns) {
        success = true
        break
      }

      // Continuation prompt
      turnPrompt = `Continue with the next steps for issue ${issue.identifier}: ${issue.title}`
    }

    agentSession.close()
    agentSession = null

    // ── Phase 6: after_run hook ────────────────────────────────────────────
    let afterRunHookError: string | undefined
    if (config.hooks_after_run) {
      try {
        await runHook(config.hooks_after_run, workspacePath, HOOK_TIMEOUT_MS, 'after_run')
      } catch (err) {
        afterRunHookError = (err as Error).message
        log(`[${issue.identifier}] after_run hook failed (non-fatal): ${afterRunHookError}`)
      }
    }

    // ── Phase 7: Exit ──────────────────────────────────────────────────────
    if (success || !abortController.signal.aborted) {
      const endedAt = new Date().toISOString()
      const tokens = {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_tokens: totalTotalTokens,
      }

      log(`[${issue.identifier}] Worker completed`)
      state.removeRunning(issueId)
      state.recordHistory(issueId, {
        attempt,
        started_at: startedAt.toISOString(),
        ended_at: endedAt,
        outcome: 'completed',
        tokens,
        after_run_hook_error: afterRunHookError,
      })
      callbacks.persistHistory?.({
        issue_id: issueId,
        identifier: issue.identifier,
        outcome: 'completed',
        attempt,
        started_at: startedAt.toISOString(),
        ended_at: endedAt,
        tokens,
        after_run_hook_error: afterRunHookError,
        written_at: new Date().toISOString(),
      })
      callbacks.onCompleted(issueId, {
        input: totalInputTokens,
        output: totalOutputTokens,
        total: totalTotalTokens,
      })
    }
  } catch (err) {
    if (agentSession) {
      agentSession.close()
      agentSession = null
    }

    const error = (err as Error).message
    log(`[${issue.identifier}] Worker failed (attempt ${attempt}): ${error}`)

    const endedAt = new Date().toISOString()
    state.removeRunning(issueId)
    state.recordHistory(issueId, {
      attempt,
      started_at: startedAt.toISOString(),
      ended_at: endedAt,
      outcome: 'failed',
      error,
    })
    callbacks.persistHistory?.({
      issue_id: issueId,
      identifier: issue.identifier,
      outcome: 'failed',
      attempt,
      started_at: startedAt.toISOString(),
      ended_at: endedAt,
      error,
      written_at: new Date().toISOString(),
    })

    if (!abortController.signal.aborted) {
      callbacks.onFailed(issueId, error, attempt)
    }
  }
}
