import { NextResponse } from 'next/server'
import { getOrchestrator } from '@/lib/symphony/orchestrator/instance'

export const dynamic = 'force-dynamic'

export function GET() {
  const state = getOrchestrator().getState()
  return NextResponse.json(state)
}
