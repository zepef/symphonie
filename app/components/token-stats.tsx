import { TokenTotals } from '@/lib/symphony/types'

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

interface TokenStatsProps {
  totals: TokenTotals
  className?: string
}

export function TokenStats({ totals, className }: TokenStatsProps) {
  return (
    <span className={`font-mono text-sm text-gray-600 dark:text-gray-400 ${className ?? ''}`}>
      {formatTokens(totals.input_tokens)}↑ {formatTokens(totals.output_tokens)}↓{' '}
      <span className="font-semibold text-gray-800 dark:text-gray-200">
        {formatTokens(totals.total_tokens)}
      </span>
    </span>
  )
}
