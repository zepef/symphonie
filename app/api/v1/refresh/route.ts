import { NextResponse } from 'next/server'
import { getOrchestrator } from '@/lib/symphony/orchestrator/instance'

export const dynamic = 'force-dynamic'

export function POST() {
  const result = getOrchestrator().requestRefresh()
  return NextResponse.json(result, { status: 202 })
}
