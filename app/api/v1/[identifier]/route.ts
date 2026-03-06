import { NextResponse } from 'next/server'
import { getOrchestrator } from '@/lib/symphony/orchestrator/instance'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params
  const detail = getOrchestrator().getIssueDetail(identifier)

  if (!detail) {
    return NextResponse.json(
      { error: { code: 'issue_not_found', message: `Issue ${identifier} not found` } },
      { status: 404 },
    )
  }

  return NextResponse.json(detail)
}
