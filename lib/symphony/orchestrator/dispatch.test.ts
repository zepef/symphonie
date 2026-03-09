import { describe, it, expect } from 'vitest'
import { sortCandidates, isEligible, availableSlots } from './dispatch'
import { OrchestratorState } from './state'
import type { Issue, ResolvedConfig } from '../types'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'id-1',
    identifier: 'PROJ-1',
    title: 'Test issue',
    description: null,
    state: 'Todo',
    priority: null,
    labels: [],
    blocked_by: [],
    created_at: new Date('2024-01-01'),
    updated_at: null,
    url: 'https://linear.app',
    ...overrides,
  }
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    tracker_kind: 'linear',
    tracker_api_key: 'key',
    tracker_project_slug: 'proj',
    tracker_dispatch_states: ['Todo', 'In Progress'],
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
    max_retry_backoff_ms: 600_000,
    notifications_on_complete: true,
    notifications_on_failure: true,
    notifications_on_retry: false,
    prompt_template: '',
    ...overrides,
  }
}

describe('sortCandidates', () => {
  it('sorts null priority last', () => {
    const issues = [
      makeIssue({ id: 'a', identifier: 'A', priority: null }),
      makeIssue({ id: 'b', identifier: 'B', priority: 1 }),
    ]
    const sorted = sortCandidates(issues)
    expect(sorted[0].identifier).toBe('B')
    expect(sorted[1].identifier).toBe('A')
  })

  it('sorts lower priority number first (urgent=1 before high=2)', () => {
    const issues = [
      makeIssue({ id: 'a', identifier: 'HIGH', priority: 2 }),
      makeIssue({ id: 'b', identifier: 'URGENT', priority: 1 }),
    ]
    const sorted = sortCandidates(issues)
    expect(sorted[0].identifier).toBe('URGENT')
    expect(sorted[1].identifier).toBe('HIGH')
  })

  it('sorts oldest first when priorities are equal', () => {
    const issues = [
      makeIssue({ id: 'a', identifier: 'NEWER', priority: 1, created_at: new Date('2024-06-01') }),
      makeIssue({ id: 'b', identifier: 'OLDER', priority: 1, created_at: new Date('2024-01-01') }),
    ]
    const sorted = sortCandidates(issues)
    expect(sorted[0].identifier).toBe('OLDER')
  })

  it('uses identifier as tiebreaker', () => {
    const date = new Date('2024-01-01')
    const issues = [
      makeIssue({ id: 'a', identifier: 'PROJ-2', priority: 1, created_at: date }),
      makeIssue({ id: 'b', identifier: 'PROJ-1', priority: 1, created_at: date }),
    ]
    const sorted = sortCandidates(issues)
    expect(sorted[0].identifier).toBe('PROJ-1')
  })
})

describe('isEligible', () => {
  it('returns true for a valid unclaimed issue', () => {
    const state = new OrchestratorState()
    const config = makeConfig()
    expect(isEligible(makeIssue(), state, config)).toBe(true)
  })

  it('returns false if not in dispatch_states', () => {
    const state = new OrchestratorState()
    const config = makeConfig()
    expect(isEligible(makeIssue({ state: 'Done' }), state, config)).toBe(false)
  })

  it('returns false if already claimed', () => {
    const state = new OrchestratorState()
    state.claim('id-1')
    const config = makeConfig()
    expect(isEligible(makeIssue(), state, config)).toBe(false)
  })

  it('returns false if global concurrency exceeded', () => {
    const state = new OrchestratorState()
    const config = makeConfig({ max_concurrent_agents: 0 })
    expect(isEligible(makeIssue(), state, config)).toBe(false)
  })

  it('returns false if in retry queue', () => {
    const state = new OrchestratorState()
    state.retryAttempts.set('id-1', {} as never)
    const config = makeConfig()
    expect(isEligible(makeIssue(), state, config)).toBe(false)
  })

  it('returns false for Todo issue with blockers', () => {
    const state = new OrchestratorState()
    const config = makeConfig()
    expect(isEligible(makeIssue({ state: 'Todo', blocked_by: ['PROJ-0'] }), state, config)).toBe(false)
  })

  it('does not apply blocker rule to non-Todo states', () => {
    const state = new OrchestratorState()
    const config = makeConfig()
    expect(isEligible(makeIssue({ state: 'In Progress', blocked_by: ['PROJ-0'] }), state, config)).toBe(true)
  })
})

describe('availableSlots', () => {
  it('returns max_concurrent_agents when nothing running', () => {
    const state = new OrchestratorState()
    const config = makeConfig({ max_concurrent_agents: 3 })
    expect(availableSlots(state, config)).toBe(3)
  })

  it('returns 0 when at capacity', () => {
    const state = new OrchestratorState()
    const config = makeConfig({ max_concurrent_agents: 1 })
    // Simulate a running entry by adding to the map
    state.running.set('x', {} as never)
    expect(availableSlots(state, config)).toBe(0)
  })
})
