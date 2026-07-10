import path from 'node:path'

/**
 * Resolve rel against root and throw if the result escapes root.
 * The containment boundary for shell.openPath (spec section 7): only paths
 * inside jobpin-data may ever be opened.
 */
export function resolveContainedPath(root: string, rel: string): string {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, rel ?? '')
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error('path escapes the data folder')
  }
  return target
}
