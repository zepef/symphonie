import { Issue, ResolvedConfig, SymphonyError } from '../types'

const LINEAR_API = 'https://api.linear.app/graphql'

async function gql(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (err) {
    throw new SymphonyError(
      'linear_api_request',
      `Linear API request failed: ${(err as Error).message}`,
      err,
    )
  }

  if (!res.ok) {
    throw new SymphonyError(
      'linear_api_status',
      `Linear API returned HTTP ${res.status}`,
    )
  }

  let body: unknown
  try {
    body = await res.json()
  } catch (err) {
    throw new SymphonyError('linear_unknown_payload', 'Failed to parse Linear API JSON', err)
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !('data' in body)
  ) {
    throw new SymphonyError('linear_unknown_payload', 'Unexpected Linear API response shape')
  }

  const anyBody = body as Record<string, unknown>
  if (anyBody.errors) {
    const msgs = (anyBody.errors as Array<{ message: string }>)
      .map((e) => e.message)
      .join('; ')
    throw new SymphonyError('linear_graphql_errors', `Linear GraphQL errors: ${msgs}`)
  }

  return anyBody.data
}

// Normalize a raw Linear issue node into our Issue type
function normalizeIssue(node: Record<string, unknown>): Issue {
  const state =
    (node.state as Record<string, unknown> | null)?.name as string ?? 'Unknown'

  const labels: string[] = ((node.labels as Record<string, unknown> | null)
    ?.nodes as Array<{ name: string }> ?? []).map((l) => l.name.toLowerCase())

  // blocked_by comes from relations where type === "blocks" on the other issue
  // Linear provides `relations` with type "blocks" meaning THIS issue blocks others
  // "blockedBy" means others block this issue
  const blocked_by: string[] = ((node.relations as Record<string, unknown> | null)
    ?.nodes as Array<{ type: string; relatedIssue: { identifier: string } }> ?? [])
    .filter((r) => r.type === 'blocks')
    .map((r) => r.relatedIssue.identifier)

  const priorityRaw = node.priority
  const priority =
    typeof priorityRaw === 'number' && priorityRaw !== 0
      ? priorityRaw
      : null

  return {
    id: node.id as string,
    identifier: node.identifier as string,
    title: node.title as string,
    description: (node.description as string | null) ?? null,
    state,
    priority,
    labels,
    blocked_by,
    created_at: node.createdAt ? new Date(node.createdAt as string) : null,
    updated_at: node.updatedAt ? new Date(node.updatedAt as string) : null,
    url: node.url as string,
  }
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  url
  createdAt
  updatedAt
  state { name }
  labels { nodes { name } }
  relations { nodes { type relatedIssue { identifier } } }
`

export async function fetchCandidateIssues(config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = []
  let after: string | null = null
  let hasNextPage = true

  while (hasNextPage) {
    const query = `
      query($slug: String!, $states: [String!]!, $first: Int!, $after: String) {
        issues(
          first: $first
          after: $after
          filter: {
            project: { slugId: { eq: $slug } }
            state: { name: { in: $states } }
          }
        ) {
          pageInfo { hasNextPage endCursor }
          nodes { ${ISSUE_FIELDS} }
        }
      }
    `
    const data = await gql(config.tracker_api_key, query, {
      slug: config.tracker_project_slug,
      states: config.tracker_dispatch_states,
      first: 50,
      after,
    }) as Record<string, unknown>

    const issuesData = data.issues as {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: Array<Record<string, unknown>>
    }

    for (const node of issuesData.nodes) {
      issues.push(normalizeIssue(node))
    }

    hasNextPage = issuesData.pageInfo.hasNextPage
    if (hasNextPage) {
      if (!issuesData.pageInfo.endCursor) {
        throw new SymphonyError(
          'linear_missing_end_cursor',
          'Linear pagination missing endCursor',
        )
      }
      after = issuesData.pageInfo.endCursor
    }
  }

  return issues
}

export async function fetchIssuesByStates(
  config: ResolvedConfig,
  stateNames: string[],
): Promise<Issue[]> {
  const query = `
    query($slug: String!, $states: [String!]!, $first: Int!) {
      issues(
        first: $first
        filter: {
          project: { slugId: { eq: $slug } }
          state: { name: { in: $states } }
        }
      ) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  `
  const data = await gql(config.tracker_api_key, query, {
    slug: config.tracker_project_slug,
    states: stateNames,
    first: 250,
  }) as Record<string, unknown>

  const issuesData = data.issues as { nodes: Array<Record<string, unknown>> }
  return issuesData.nodes.map(normalizeIssue)
}

export async function fetchIssueStatesByIds(
  config: ResolvedConfig,
  issueIds: string[],
): Promise<Map<string, string>> {
  if (issueIds.length === 0) return new Map()

  const query = `
    query($ids: [ID!]!) {
      issues(filter: { id: { in: $ids } }, first: 250) {
        nodes { id state { name } }
      }
    }
  `
  const data = await gql(config.tracker_api_key, query, { ids: issueIds }) as Record<string, unknown>
  const issuesData = data.issues as {
    nodes: Array<{ id: string; state: { name: string } }>
  }

  const map = new Map<string, string>()
  for (const node of issuesData.nodes) {
    map.set(node.id, node.state.name)
  }
  return map
}

// Execute an arbitrary GraphQL query (for the linear_graphql tool)
export async function executeLinearGraphQL(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<unknown> {
  return gql(apiKey, query, variables)
}
