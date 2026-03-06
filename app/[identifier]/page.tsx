'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { use } from 'react'
import { IssueDetail } from '@/lib/symphony/types'
import { StatusBadge } from '../components/status-badge'
import { TimeAgo } from '../components/time-ago'
import { formatTokens } from '../components/token-stats'

export default function IssuePage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = use(params)
  const [data, setData] = useState<IssueDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/v1/${identifier}`)
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setData(await res.json() as IssueDetail)
      } finally {
        setLoading(false)
      }
    }
    void load()
    const interval = setInterval(() => void load(), 5_000)
    return () => clearInterval(interval)
  }, [identifier])

  if (loading) {
    return (
      <main className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="h-6 bg-gray-100 dark:bg-gray-800 rounded animate-pulse w-48" />
          <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        </div>
      </main>
    )
  }

  if (notFound || !data) {
    return (
      <main className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-6">
        <div className="mx-auto max-w-3xl">
          <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-6 inline-block">
            &larr; Back
          </Link>
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-6 py-8 text-center">
            <p className="text-lg font-semibold text-red-700 dark:text-red-300">Issue not found</p>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{identifier} is not tracked by the orchestrator</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          &larr; Back to dashboard
        </Link>

        {/* Issue header */}
        <div className="flex items-start gap-3">
          <span className="font-mono text-lg font-semibold text-gray-500 dark:text-gray-400">
            {data.identifier}
          </span>
          <StatusBadge status={data.state} />
          {data.completed && <StatusBadge status="completed" />}
        </div>
        <h1 className="text-xl font-semibold -mt-2">{data.title}</h1>

        {/* Running session card */}
        {data.running && (
          <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-green-800 dark:text-green-300">Active Session</span>
              <span className="text-xs text-green-600 dark:text-green-400">
                Started <TimeAgo timestamp={data.running.started_at} />
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Dt>Attempt</Dt><Dd>{data.running.attempt}</Dd>
              <Dt>Turns</Dt><Dd>{data.running.session.turn_count}</Dd>
              <Dt>PID</Dt><Dd className="font-mono">{data.running.session.pid ?? '—'}</Dd>
              <Dt>Tokens</Dt><Dd className="font-mono">{formatTokens(data.running.session.total_tokens)}</Dd>
              <Dt>Last Event</Dt>
              <Dd>
                {data.running.session.last_event
                  ? <StatusBadge status={data.running.session.last_event} size="sm" />
                  : '—'}
              </Dd>
              <Dt>Last Message</Dt>
              <Dd className="col-span-1 truncate" title={data.running.session.last_message}>
                {data.running.session.last_message || '—'}
              </Dd>
            </dl>
          </div>
        )}

        {/* Retry card */}
        {data.retrying && (
          <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/10 p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                Retry queued — attempt #{data.retrying.attempt}
              </span>
              <span className="text-xs text-yellow-600 dark:text-yellow-400">
                <TimeAgo timestamp={data.retrying.retry_at} future />
              </span>
            </div>
            <p className="text-xs text-yellow-700 dark:text-yellow-400">{data.retrying.error}</p>
          </div>
        )}

        {/* History */}
        {data.history.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
              Run History
            </h2>
            <div className="space-y-2">
              {data.history.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-gray-400">#{h.attempt}</span>
                    <StatusBadge status={h.outcome} size="sm" />
                    {h.error && (
                      <span className="text-xs text-gray-500 truncate max-w-xs" title={h.error}>
                        {h.error}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    {h.tokens && (
                      <span className="font-mono">{formatTokens(h.tokens.total_tokens)} tok</span>
                    )}
                    <TimeAgo timestamp={h.started_at} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="text-gray-500 dark:text-gray-400">{children}</dt>
}

function Dd({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <dd className={`font-medium text-gray-800 dark:text-gray-200 ${className ?? ''}`} title={title}>
      {children}
    </dd>
  )
}
