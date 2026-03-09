export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { getOrchestrator } = await import('./lib/symphony/orchestrator/instance')
      const workflowPath = process.env.SYMPHONY_WORKFLOW_PATH
      await getOrchestrator().start(workflowPath)
    } catch (err) {
      console.error('[symphony] Orchestrator failed to start:', err)
    }
  }
}
