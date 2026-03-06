export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getOrchestrator } = await import('./lib/symphony/orchestrator/instance')
    const workflowPath = process.env.SYMPHONY_WORKFLOW_PATH
    await getOrchestrator().start(workflowPath)
  }
}
