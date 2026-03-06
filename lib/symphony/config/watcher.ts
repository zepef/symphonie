import chokidar, { FSWatcher } from 'chokidar'

export function watchWorkflowFile(
  filePath: string,
  onChange: () => void,
): FSWatcher {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
  })

  watcher.on('change', () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, 200)
  })

  return watcher
}
