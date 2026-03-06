import { Liquid } from 'liquidjs'
import { Issue, SymphonyError } from '../types'

const engine = new Liquid({ strictVariables: true, strictFilters: true })

export interface PromptContext {
  issue: Issue
  attempt: number
}

export async function renderPrompt(
  template: string,
  ctx: PromptContext,
): Promise<string> {
  try {
    return await engine.parseAndRender(template, ctx)
  } catch (err) {
    throw new SymphonyError(
      'prompt_render_error',
      `Prompt template render failed: ${(err as Error).message}`,
      err,
    )
  }
}
