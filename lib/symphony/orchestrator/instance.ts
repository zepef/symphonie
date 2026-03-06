import { Orchestrator } from './index'

declare global {
  var __symphonyOrchestrator: Orchestrator | undefined
}

export function getOrchestrator(): Orchestrator {
  if (!globalThis.__symphonyOrchestrator) {
    globalThis.__symphonyOrchestrator = new Orchestrator()
  }
  return globalThis.__symphonyOrchestrator
}
