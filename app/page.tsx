'use client'

import { useEffect, useState, useCallback } from 'react'
import { StateResponse } from '@/lib/symphony/types'
import { apiFetch } from './lib/api-fetch'
import { RunningTable } from './components/running-table'
import { RetryQueue } from './components/retry-queue'
import { TokenStats } from './components/token-stats'
import { TimeAgo } from './components/time-ago'

const POLL_INTERVAL_MS = 5_000

export default function DashboardPage() {
  const [data, setData] = useState<StateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchState = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/state')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as StateResponse
      setData(json)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchState()
    const interval = setInterval(() => void fetchState(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchState])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await apiFetch('/api/v1/refresh', { method: 'POST' })
      await fetchState()
    } finally {
      setRefreshing(false)
    }
  }

  const statusDot = data?.status === 'running' ? 'bg-green-500' : 'bg-gray-400'

  return (
    <main className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot}`} />
            <h1 className="text-lg font-semibold tracking-tight">Symphony</h1>
            {data?.workflow_path && (
              <span className="hidden sm:block font-mono text-xs text-gray-400 dark:text-gray-500 truncate max-w-xs">
                {data.workflow_path}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {data?.last_poll_at && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                polled <TimeAgo timestamp={data.last_poll_at} />
              </span>
            )}
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="rounded-md bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {refreshing ? 'Refreshing\u2026' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-6 space-y-8">
        {/* Error banner */}
        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            Failed to fetch state: {error}
          </div>
        )}

        {/* Config error banner */}
        {data && !data.config_valid && data.config_error && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <span className="font-semibold">Config error:</span> {data.config_error}
          </div>
        )}

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Running" value={data?.running.length ?? 0} color="text-green-600 dark:text-green-400" />
          <StatCard label="Retrying" value={data?.retrying.length ?? 0} color="text-yellow-600 dark:text-yellow-400" />
          <StatCard label="Completed" value={data?.completed_count ?? 0} color="text-blue-600 dark:text-blue-400" />
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-3">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Tokens</div>
            {data ? (
              <TokenStats totals={data.token_totals} />
            ) : (
              <span className="text-sm text-gray-400">&mdash;</span>
            )}
          </div>
        </div>

        {/* Running Sessions */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
            Running Sessions
          </h2>
          <RunningTable sessions={data?.running ?? []} loading={loading} />
        </section>

        {/* Retry Queue */}
        {(loading || (data && data.retrying.length > 0)) && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
              Retry Queue
            </h2>
            <RetryQueue entries={data?.retrying ?? []} />
          </section>
        )}

        {/* Footer */}
        {data && (
          <footer className="text-xs text-gray-400 dark:text-gray-500 pt-4 border-t border-gray-100 dark:border-gray-800">
            Uptime: {formatUptime(data.uptime_ms)}
            {data.workflow_path && (
              <span className="ml-4 hidden sm:inline">Workflow: {data.workflow_path}</span>
            )}
          </footer>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-3">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  )
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
