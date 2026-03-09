import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveConfig } from './config-layer'
import { SymphonyError } from '../types'
import type { WorkflowDefinition } from '../types'

const baseConfig = (): WorkflowDefinition => ({
  config: {
    tracker: { kind: 'linear', api_key: 'test-key', project_slug: 'my-project' },
  },
  prompt_template: 'Hello {{issue.title}}',
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveConfig', () => {
  it('resolves literal api_key directly', () => {
    const cfg = resolveConfig(baseConfig())
    expect(cfg.tracker_api_key).toBe('test-key')
  })

  it('resolves $VAR references from env', () => {
    vi.stubEnv('MY_LINEAR_KEY', 'env-value')
    const def = baseConfig()
    def.config.tracker!.api_key = '$MY_LINEAR_KEY'
    const cfg = resolveConfig(def)
    expect(cfg.tracker_api_key).toBe('env-value')
  })

  it('throws missing_tracker_api_key when key is absent', () => {
    const def = baseConfig()
    def.config.tracker!.api_key = undefined
    expect(() => resolveConfig(def)).toThrow(SymphonyError)
    try {
      resolveConfig(def)
    } catch (e) {
      expect((e as SymphonyError).code).toBe('missing_tracker_api_key')
    }
  })

  it('throws missing_tracker_api_key when $VAR is empty', () => {
    vi.stubEnv('MISSING_VAR', '')
    const def = baseConfig()
    def.config.tracker!.api_key = '$MISSING_VAR'
    expect(() => resolveConfig(def)).toThrow(SymphonyError)
  })

  it('throws unsupported_tracker_kind for non-linear tracker', () => {
    const def = baseConfig()
    def.config.tracker!.kind = 'github'
    try {
      resolveConfig(def)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as SymphonyError).code).toBe('unsupported_tracker_kind')
    }
  })

  it('applies default max_concurrent_agents = 3', () => {
    const cfg = resolveConfig(baseConfig())
    expect(cfg.max_concurrent_agents).toBe(3)
  })

  it('applies default stall_timeout_ms = 300000', () => {
    const cfg = resolveConfig(baseConfig())
    expect(cfg.stall_timeout_ms).toBe(300_000)
  })

  it('applies default poll_interval_ms = 60000', () => {
    const cfg = resolveConfig(baseConfig())
    expect(cfg.poll_interval_ms).toBe(60_000)
  })

  it('applies default max_retries = 3', () => {
    const cfg = resolveConfig(baseConfig())
    expect(cfg.max_retries).toBe(3)
  })

  it('applies default dispatch_states', () => {
    const cfg = resolveConfig(baseConfig())
    expect(cfg.tracker_dispatch_states).toEqual(['Todo', 'In Progress'])
  })

  it('expands tilde in workspace_root', () => {
    const def = baseConfig()
    def.config.workspace = { root: '~/my-workspaces' }
    const cfg = resolveConfig(def)
    expect(cfg.workspace_root).not.toContain('~')
    expect(cfg.workspace_root).toMatch(/my-workspaces$/)
  })

  it('resolves notification defaults', () => {
    const cfg = resolveConfig(baseConfig())
    expect(cfg.notifications_on_complete).toBe(true)
    expect(cfg.notifications_on_failure).toBe(true)
    expect(cfg.notifications_on_retry).toBe(false)
    expect(cfg.notifications_webhook_url).toBeUndefined()
  })

  it('throws config_validation_error for max_concurrent_agents < 1', () => {
    const def = baseConfig()
    def.config.concurrency = { max_workers: 0 }
    try {
      resolveConfig(def)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as SymphonyError).code).toBe('config_validation_error')
    }
  })

  it('throws config_validation_error for poll_interval_ms < 1000', () => {
    const def = baseConfig()
    def.config.polling = { interval_ms: 500 }
    try {
      resolveConfig(def)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as SymphonyError).code).toBe('config_validation_error')
    }
  })

  it('throws config_validation_error for max_turns < 1', () => {
    const def = baseConfig()
    def.config.codex = { max_turns: 0 }
    try {
      resolveConfig(def)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as SymphonyError).code).toBe('config_validation_error')
    }
  })

  it('throws config_validation_error for negative max_retries', () => {
    const def = baseConfig()
    def.config.retry = { max_retries: -1 }
    try {
      resolveConfig(def)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as SymphonyError).code).toBe('config_validation_error')
    }
  })

  it('allows stall_timeout_ms = 0 (disabled)', () => {
    const def = baseConfig()
    def.config.codex = { stall_timeout_ms: 0 }
    const cfg = resolveConfig(def)
    expect(cfg.stall_timeout_ms).toBe(0)
  })

  it('resolves $ENV_VAR in webhook_url', () => {
    vi.stubEnv('WEBHOOK_URL', 'https://example.com/hook')
    const def = baseConfig()
    def.config.notifications = { webhook_url: '$WEBHOOK_URL' }
    const cfg = resolveConfig(def)
    expect(cfg.notifications_webhook_url).toBe('https://example.com/hook')
  })
})
