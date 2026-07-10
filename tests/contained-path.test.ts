import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveContainedPath } from '../src/main/contained-path'

const root = path.resolve('jobpin-data-test-root')

describe('resolveContainedPath', () => {
  it('allows the root itself (empty rel)', () => {
    expect(resolveContainedPath(root, '')).toBe(root)
  })

  it('allows nested relative paths', () => {
    expect(resolveContainedPath(root, 'jobs/X/candidates')).toBe(path.join(root, 'jobs', 'X', 'candidates'))
  })

  it('rejects parent traversal', () => {
    expect(() => resolveContainedPath(root, '..')).toThrow(/escapes/)
  })

  it('rejects traversal hidden inside a nested path', () => {
    expect(() => resolveContainedPath(root, 'jobs/../../outside')).toThrow(/escapes/)
  })

  it('rejects absolute-path override', () => {
    expect(() => resolveContainedPath(root, path.resolve('somewhere-else'))).toThrow(/escapes/)
  })

  it('rejects a sibling directory sharing the root prefix', () => {
    expect(() => resolveContainedPath(root, '../jobpin-data-test-root2/x')).toThrow(/escapes/)
  })
})
