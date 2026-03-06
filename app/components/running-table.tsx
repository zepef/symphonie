import Link from 'next/link'
import { RunningEntrySummary } from '@/lib/symphony/types'
import { StatusBadge } from './status-badge'
import { TimeAgo } from './time-ago'
import { formatTokens } from './token-stats'

interface RunningTableProps {
  sessions: RunningEntrySummary[]
  loading?: boolean
}

export function RunningTable({ sessions, loading }: RunningTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
        No active sessions
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            <th className="pb-2 pr-4">Issue</th>
            <th className="pb-2 pr-4">State</th>
            <th className="pb-2 pr-4">Turns</th>
            <th className="pb-2 pr-4">Last Event</th>
            <th className="pb-2 pr-4 max-w-xs">Last Message</th>
            <th className="pb-2 pr-4">Started</th>
            <th className="pb-2">Tokens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {sessions.map((s) => (
            <tr key={s.identifier} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="py-3 pr-4">
                <Link
                  href={`/${s.identifier}`}
                  className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {s.identifier}
                </Link>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[160px]">
                  {s.title}
                </div>
              </td>
              <td className="py-3 pr-4">
                <StatusBadge status={s.state} />
              </td>
              <td className="py-3 pr-4 font-mono text-gray-700 dark:text-gray-300">
                {s.session.turn_count}
              </td>
              <td className="py-3 pr-4">
                {s.session.last_event ? (
                  <StatusBadge status={s.session.last_event} size="sm" />
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="py-3 pr-4 max-w-xs">
                <span
                  className="block text-gray-600 dark:text-gray-400 truncate"
                  title={s.session.last_message}
                >
                  {s.session.last_message || '—'}
                </span>
              </td>
              <td className="py-3 pr-4 whitespace-nowrap text-gray-500 dark:text-gray-400">
                <TimeAgo timestamp={s.started_at} />
              </td>
              <td className="py-3 font-mono text-gray-600 dark:text-gray-400">
                {formatTokens(s.session.total_tokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
