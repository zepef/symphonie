import { NextResponse } from 'next/server'
import { getOrchestrator } from '@/lib/symphony/orchestrator/instance'

export const dynamic = 'force-dynamic'

export function GET() {
  const state = getOrchestrator().getState()
  return NextResponse.json({
    status: 'ok',
    uptime_ms: state.uptime_ms,
    orchestrator_status: state.status,
    config_valid: state.config_valid,
    version: process.env.npm_package_version ?? '0.0.0',
  })
}
