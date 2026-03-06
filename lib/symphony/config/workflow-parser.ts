import * as fs from 'fs'
import matter from 'gray-matter'
import { SymphonyError, WorkflowDefinition } from '../types'

export function parseWorkflowFile(filePath: string): WorkflowDefinition {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new SymphonyError(
      'missing_workflow_file',
      `Cannot read WORKFLOW.md at ${filePath}`,
      err,
    )
  }

  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(raw)
  } catch (err) {
    throw new SymphonyError(
      'workflow_parse_error',
      `Failed to parse YAML front matter in ${filePath}`,
      err,
    )
  }

  const data = parsed.data
  if (data !== null && typeof data !== 'object') {
    throw new SymphonyError(
      'workflow_front_matter_not_a_map',
      'WORKFLOW.md front matter must be a YAML mapping, not a scalar',
    )
  }

  return {
    config: (data as Record<string, unknown>) ?? {},
    prompt_template: parsed.content.trim(),
  }
}
