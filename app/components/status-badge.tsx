interface StatusBadgeProps {
  status: string
  size?: 'sm' | 'md'
}

function getStatusColor(status: string): string {
  const s = status.trim().toLowerCase()
  if (s === 'completed' || s === 'done' || s === 'running') return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
  if (s === 'failed' || s === 'cancelled' || s === 'duplicate') return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  if (s === 'retrying' || s === 'queued' || s === 'in_progress' || s === 'in progress') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
  if (s === 'todo' || s === 'dispatched' || s === 'claimed') return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const color = getStatusColor(status)
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${padding} ${color}`}>
      {status}
    </span>
  )
}
