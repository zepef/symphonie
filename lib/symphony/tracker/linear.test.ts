import { describe, it, expect, vi, afterEach } from 'vitest'
import { SymphonyError } from '../types'
import type { ResolvedConfig } from '../types'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    tracker_kind: 'linear',
    tracker_api_key: 'test-key',
    tracker_project_slug: 'proj-slug',
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
    max_retry_backoff_ms: 600_000,
    notifications_on_complete: true,
    notifications_on_failure: true,
    notifications_on_retry: false,
    prompt_template: '',
    ...overrides,
  }
}

function makeIssueNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'issue-abc',
    identifier: 'PROJ-1',
    title: 'Test Issue',
    description: 'Some description',
    priority: 0,
    url: 'https://linear.app/proj/issue/PROJ-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    state: { name: 'Todo' },
    labels: { nodes: [] },
    relations: { nodes: [] },
    ...overrides,
  }
}

function mockFetch(data: Record<string, unknown>, errors?: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data, errors }),
  }))
}

function mockFetchStatus(status: number) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => `HTTP ${status}`,
  }))
}

function pageResponse(nodes: Record<string, unknown>[]) {
  return {
    issues: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  }
}

describe('normalizeIssue (via fetchCandidateIssues)', () => {
  it('maps priority 0 to null', async () => {
    mockFetch(pageResponse([makeIssueNode({ priority: 0 })]))
    const { fetchCandidateIssues } = await import('./linear')
    const issues = await fetchCandidateIssues(makeConfig())
    expect(issues[0].priority).toBeNull()
  })

  it('keeps non-zero priority as a number', async () => {
    mockFetch(pageResponse([makeIssueNode({ priority: 1 })]))
    const { fetchCandidateIssues } = await import('./linear')
    const issues = await fetchCandidateIssues(makeConfig())
    expect(issues[0].priority).toBe(1)
  })

  it('maps empty labels to []', async () => {
    mockFetch(pageResponse([makeIssueNode({ labels: { nodes: [] } })]))
    const { fetchCandidateIssues } = await import('./linear')
    const issues = await fetchCandidateIssues(makeConfig())
    expect(issues[0].labels).toEqual([])
  })

  it('maps missing description to null', async () => {
    mockFetch(pageResponse([makeIssueNode({ description: null })]))
    const { fetchCandidateIssues } = await import('./linear')
    const issues = await fetchCandidateIssues(makeConfig())
    expect(issues[0].description).toBeNull()
  })

  it('extracts blocked_by from inverse relations with type "blocks"', async () => {
    mockFetch(pageResponse([makeIssueNode({
      relations: {
        nodes: [
          { type: 'blocks', relatedIssue: { identifier: 'PROJ-0' } },
          { type: 'duplicate', relatedIssue: { identifier: 'PROJ-2' } },
        ],
      },
    })]))
    const { fetchCandidateIssues } = await import('./linear')
    const issues = await fetchCandidateIssues(makeConfig())
    expect(issues[0].blocked_by).toEqual(['PROJ-0'])
  })
})

describe('fetchCandidateIssues error handling', () => {
  it('throws SymphonyError with linear_api_status on HTTP 4xx', async () => {
    mockFetchStatus(401)
    const { fetchCandidateIssues } = await import('./linear')
    await expect(fetchCandidateIssues(makeConfig())).rejects.toSatisfy(
      (e: unknown) => e instanceof SymphonyError && (e as SymphonyError).code === 'linear_api_status',
    )
  })

  it('throws SymphonyError with linear_graphql_errors on GraphQL error array', async () => {
    mockFetch({}, [{ message: 'Authentication required' }])
    const { fetchCandidateIssues } = await import('./linear')
    await expect(fetchCandidateIssues(makeConfig())).rejects.toSatisfy(
      (e: unknown) => e instanceof SymphonyError && (e as SymphonyError).code === 'linear_graphql_errors',
    )
  })
})
