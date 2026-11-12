import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** A thin wrapper over the git commands the file set needs. Arguments are always an array, never a shell. */
export function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trimEnd()
}

/** Blob SHA of every tracked file, from the index: free, and exact for a clean tree. */
export function blobShas(cwd: string): ReadonlyMap<string, string> {
  const out = git(['ls-tree', '-r', 'HEAD'], cwd)
  const shas = new Map<string, string>()
  for (const line of out.split('\n')) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line)
    if (match?.[1] && match[2]) shas.set(match[2], match[1])
  }
  return shas
}

/**
 * Every file the working tree holds: tracked, plus untracked and not ignored.
 * A file deleted on disk is left out, and a file that has never been added is
 * picked up, so the index follows the tree a developer is reading.
 */
export function worktreeFiles(cwd: string): readonly string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    },
  )
  return out
    .split('\0')
    .filter((file) => file !== '' && existsSync(join(cwd, file)))
    .toSorted()
}

/** Blob SHAs of the files as they are on disk, so uncommitted edits show as changed. */
export function worktreeBlobShas(
  cwd: string,
  files: readonly string[],
): ReadonlyMap<string, string> {
  const present = files.filter((file) => existsSync(join(cwd, file)))
  if (present.length === 0) return new Map()
  const out = execFileSync('git', ['hash-object', '--stdin-paths'], {
    cwd,
    encoding: 'utf8',
    input: present.join('\n'),
    maxBuffer: 1 << 26,
  })
    .trimEnd()
    .split('\n')
  const shas = new Map<string, string>()
  present.forEach((file, index) => {
    const sha = out[index]
    if (sha) shas.set(file, sha)
  })
  return shas
}

export function headCommit(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd)
}

export function commitsBehind(cwd: string, indexed: string): number | null {
  try {
    return Number(git(['rev-list', '--count', `${indexed}..HEAD`], cwd))
  } catch {
    return null
  }
}

/** `owner/repository` when the origin is a GitHub remote, otherwise `undefined`. */
export function remoteSlug(cwd: string): string | undefined {
  try {
    const url = git(['remote', 'get-url', 'origin'], cwd)
    return /github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url)?.[1]
  } catch {
    return undefined
  }
}
