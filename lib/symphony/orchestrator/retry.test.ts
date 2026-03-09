import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calcBackoffMs, scheduleRetry } from './retry'
import { OrchestratorState } from './state'
import type { ResolvedConfig } from '../types'

const MAX_BACKOFF = 600_000

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    tracker_kind: 'linear',
    tracker_api_key: 'key',
    tracker_project_slug: 'proj',
    tracker_dispatch_states: ['Todo'],
    tracker_terminal_states: ['Done'],
    max_concurrent_agents: 3,
    max_concurrent_agents_by_state: {},
    workspace_root: '/tmp',
    codex_command: 'codex',
    stall_timeout_ms: 300_000,
    read_timeout_ms: 30_000,
    turn_timeout_ms: 600_000,
    max_turns: 10,
    poll_interval_ms: 60_000,
    max_retries: 3,
    max_retry_backoff_ms: MAX_BACKOFF,
    notifications_on_complete: true,
    notifications_on_failure: true,
    notifications_on_retry: false,
    prompt_template: '',
    ...overrides,
  }
}

describe('calcBackoffMs', () => {
  it('returns 1000 for attempt=1 (continuation retry)', () => {
    expect(calcBackoffMs(1, MAX_BACKOFF)).toBe(1000)
  })

  it('returns 20000 for attempt=2 (10000 * 2^1)', () => {
    expect(calcBackoffMs(2, MAX_BACKOFF)).toBe(20_000)
  })

  it('returns 40000 for attempt=3 (10000 * 2^2)', () => {
    expect(calcBackoffMs(3, MAX_BACKOFF)).toBe(40_000)
  })

  it('caps at max_retry_backoff_ms for large attempts', () => {
    expect(calcBackoffMs(10, MAX_BACKOFF)).toBe(MAX_BACKOFF)
  })

  it('caps with custom max', () => {
    expect(calcBackoffMs(4, 50_000)).toBe(50_000)
  })
})

describe('scheduleRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores a RetryEntry with correct retry_at', () => {
    const state = new OrchestratorState()
    const config = makeConfig()
    const onFired = vi.fn()

    scheduleRetry('issue-1', 'PROJ-1', 2, 'some error', state, config, onFired)

    const entry = state.retryAttempts.get('issue-1')
    expect(entry).toBeDefined()
    expect(entry?.identifier).toBe('PROJ-1')
    expect(entry?.attempt).toBe(2)
    expect(entry?.error).toBe('some error')
    // retry_at should be ~20s in the future
    expect(entry!.retry_at.getTime()).toBeGreaterThan(Date.now())
    expect(entry!.retry_at.getTime()).toBeLessThanOrEqual(Date.now() + 20_001)
  })

  it('fires callback after delay', () => {
    const state = new OrchestratorState()
    const config = makeConfig()
    const onFired = vi.fn()

    scheduleRetry('issue-2', 'PROJ-2', 2, 'error', state, config, onFired)
    expect(onFired).not.toHaveBeenCalled()

    vi.advanceTimersByTime(20_001)
    expect(onFired).toHaveBeenCalledWith('issue-2')
  })

  it('cancels existing retry before scheduling new one', () => {
    const state = new OrchestratorState()
    const config = makeConfig()
    const onFired1 = vi.fn()
    const onFired2 = vi.fn()

    scheduleRetry('issue-3', 'PROJ-3', 2, 'first', state, config, onFired1)
    scheduleRetry('issue-3', 'PROJ-3', 2, 'second', state, config, onFired2)

    vi.advanceTimersByTime(25_000)
    expect(onFired1).not.toHaveBeenCalled()
    expect(onFired2).toHaveBeenCalledOnce()
  })
})
