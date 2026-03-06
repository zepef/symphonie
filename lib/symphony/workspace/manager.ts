import * as fs from 'fs'
import * as path from 'path'
import { Issue, ResolvedConfig, SymphonyError } from '../types'
import { sanitizeKey } from './sanitize'
import { runHook } from './hooks'

const HOOK_TIMEOUT_MS = 60_000

const log = (...args: unknown[]) => console.log('[symphony:workspace]', ...args)

export interface PrepareResult {
  path: string
  created_now: boolean
}

export async function prepareWorkspace(
  issue: Issue,
  config: ResolvedConfig,
): Promise<PrepareResult> {
  const key = sanitizeKey(issue.identifier)
  const workspacePath = path.join(config.workspace_root, key)
  const absRoot = path.resolve(config.workspace_root)
  const absWorkspace = path.resolve(workspacePath)

  // Path containment invariant
  if (!absWorkspace.startsWith(absRoot + path.sep) && absWorkspace !== absRoot) {
    throw new SymphonyError(
      'workspace_path_escape',
      `Workspace path ${absWorkspace} escapes root ${absRoot}`,
    )
  }

  const exists = fs.existsSync(workspacePath)

  if (!exists) {
    log(`Creating workspace: ${workspacePath}`)
    fs.mkdirSync(workspacePath, { recursive: true })
  }

  const created_now = !exists

  if (created_now && config.hooks_after_create) {
    // Fatal if fails
    await runHook(config.hooks_after_create, workspacePath, HOOK_TIMEOUT_MS, 'after_create')
  }

  return { path: workspacePath, created_now }
}

export async function removeWorkspace(
  workspacePath: string,
  config: ResolvedConfig,
): Promise<void> {
  if (config.hooks_before_remove) {
    try {
      await runHook(config.hooks_before_remove, workspacePath, HOOK_TIMEOUT_MS, 'before_remove')
    } catch (err) {
      log(`before_remove hook failed (ignored): ${(err as Error).message}`)
    }
  }

  try {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    log(`Removed workspace: ${workspacePath}`)
  } catch (err) {
    log(`Failed to remove workspace ${workspacePath}: ${(err as Error).message}`)
  }
}
