/**
 * Normalize a path to forward slashes (POSIX-style). c12 returns posix-style `cwd`s while Node's
 * `path` helpers are OS-native (backslashes on Windows); paths must be canonicalized to forward
 * slashes before they are compared for dedup or emitted into a Vite config/alias, where posix is
 * conventional. Shared by every module so the rule lives in exactly one place.
 */
const SEPARATOR_RE = /\\/g
export const toPosix = (p: string): string => p.replace(SEPARATOR_RE, '/')
