export function sanitizeKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, '_')
}
