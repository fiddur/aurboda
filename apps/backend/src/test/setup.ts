/**
 * Vitest setup file — runs before every test file.
 *
 * Suppresses console output during tests to keep CI logs clean.
 * Tests can still assert on calls:
 *
 *   expect(console.error).toHaveBeenCalledWith(...)
 */
import { beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
