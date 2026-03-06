'use client'

import { useEffect, useState } from 'react'

export function formatRelativeTime(ts: string | Date, future = false): string {
  const date = typeof ts === 'string' ? new Date(ts) : ts
  const now = Date.now()
  const diffMs = future ? date.getTime() - now : now - date.getTime()
  const diffSec = Math.round(Math.abs(diffMs) / 1000)

  if (diffSec < 10) return future ? 'in a moment' : 'just now'
  if (diffSec < 60) return future ? `in ${diffSec}s` : `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return future ? `in ${diffMin}m` : `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return future ? `in ${diffHr}h` : `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return future ? `in ${diffDay}d` : `${diffDay}d ago`
}

interface TimeAgoProps {
  timestamp: string | Date
  future?: boolean
  className?: string
}

export function TimeAgo({ timestamp, future = false, className }: TimeAgoProps) {
  const [display, setDisplay] = useState(() => formatRelativeTime(timestamp, future))

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplay(formatRelativeTime(timestamp, future))
    }, 10_000)
    return () => clearInterval(interval)
  }, [timestamp, future])

  const iso = typeof timestamp === 'string' ? timestamp : timestamp.toISOString()
  return (
    <time dateTime={iso} title={iso} className={className}>
      {display}
    </time>
  )
}
