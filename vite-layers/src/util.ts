import { readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/**
 * Normalize a path to forward slashes (POSIX-style). c12 returns posix-style `cwd`s while Node's
 * `path` helpers are OS-native (backslashes on Windows); paths must be canonicalized to forward
 * slashes before they are compared for dedup or emitted into a Vite config/alias, where posix is
 * conventional. Shared by every module so the rule lives in exactly one place.
 */
const SEPARATOR_RE = /\\/g
export const toPosix = (p: string): string => p.replace(SEPARATOR_RE, '/')

/**
 * Recursively list files under a directory (absolute paths); `[]` if it isn't a directory.
 * withFileTypes: half the syscalls of a per-entry statSync walk; only symlinks still need a stat
 * (to follow them), and a broken one / a file unlinked mid-walk (ENOENT) is skipped, not fatal.
 */
export function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    let isDir = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      try {
        isDir = statSync(abs).isDirectory()
      } catch {
        continue
      }
    }
    if (isDir) walkFiles(abs, out)
    else out.push(abs)
  }
  return out
}
