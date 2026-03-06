import Link from 'next/link'
import { RetryEntrySummary } from '@/lib/symphony/types'
import { TimeAgo } from './time-ago'

interface RetryQueueProps {
  entries: RetryEntrySummary[]
}

export function RetryQueue({ entries }: RetryQueueProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
        No retries queued
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div
          key={e.identifier}
          className="flex items-start justify-between rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Link
                href={`/${e.identifier}`}
                className="font-mono text-sm font-semibold text-yellow-800 dark:text-yellow-300 hover:underline"
              >
                {e.identifier}
              </Link>
              <span className="text-xs text-yellow-600 dark:text-yellow-400">
                attempt #{e.attempt}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-yellow-700 dark:text-yellow-400 truncate" title={e.error}>
              {e.error}
            </p>
          </div>
          <div className="ml-4 shrink-0 text-xs text-yellow-600 dark:text-yellow-400 whitespace-nowrap">
            <TimeAgo timestamp={e.retry_at} future />
          </div>
        </div>
      ))}
    </div>
  )
}
