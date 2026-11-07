import { spawn } from 'node:child_process'

import { ExternalSourceError } from '@quill/application'

/**
 * The `git` CLI, run hardened (ADR-061, "The CLI is run hardened").
 *
 * Every invocation is an argument array with no shell, in an environment
 * built from nothing rather than inherited, so the operator's own Git setup —
 * system and global configuration, credential helpers, hooks, `.netrc`, trace
 * variables — cannot reach a fetch the instance makes on a customer's behalf.
 * All configuration is passed as `GIT_CONFIG_COUNT` environment entries, not
 * `-c` arguments: a credential or a proxy address in an argument is visible
 * to every user on the machine through the process list, and the environment
 * is visible only to the process's own user. Child processes `git` starts
 * itself (the fetch inside `git backfill`) inherit both.
 *
 * Commands that do not talk to the remote run with `GIT_NO_LAZY_FETCH=1`, so
 * a command that would need a blob outside the source fails instead of
 * fetching it. Every command has a timeout and an output cap.
 */

/** A credential for the remote, sent as HTTP Basic authentication. */
export interface SourceCredential {
  readonly username: string
  readonly password: string
}

export interface GitCliOptions {
  readonly executable: string
  /** An empty directory of this source's own: `HOME`, so no `.netrc` or `.gitconfig` is found. */
  readonly home: string
  /** Repository discovery stops here, so a cache inside someone else's checkout never reads its configuration. */
  readonly ceiling: string
  readonly localTimeoutMs: number
  readonly networkTimeoutMs: number
  readonly maxOutputBytes: number
  readonly allowFileProtocol: boolean
  readonly egressProxy?: string
}

export interface GitCommand {
  readonly subcommand: string
  readonly args?: readonly string[]
  readonly cwd: string
  /** Talks to the remote: lazy fetching stays on, the network timeout applies, and the credential goes along. */
  readonly network?: { readonly credential: SourceCredential | null }
  readonly stdin?: string
  /** Exit codes that answer a question rather than report a failure, such as `merge-base --is-ancestor`'s 1. */
  readonly answers?: readonly number[]
  /** Overrides the output cap, for a command whose caller bounds what it keeps. */
  readonly maxOutputBytes?: number
  /**
   * A limit shared by several commands, such as one whole fetch. The command
   * stops at its own timeout or at the deadline, whichever comes first.
   */
  readonly deadline?: Deadline
}

export interface Deadline {
  readonly signal: AbortSignal
  /** What the deadline bounds, and how long it had, for the refusal. */
  readonly description: string
}

export interface GitResult {
  readonly code: number
  readonly stdout: Buffer
}

/**
 * Git refers to the null device by this name on every platform; Git for
 * Windows maps it. `os.devNull` (`\\.\nul`) is refused there as a
 * configuration file.
 */
const NULL_DEVICE = '/dev/null'
const STDERR_LIMIT = 16 * 1024
const MESSAGE_LIMIT = 1000

export class GitCli {
  readonly #options: GitCliOptions

  constructor(options: GitCliOptions) {
    this.#options = options
  }

  async run(command: GitCommand): Promise<GitResult> {
    const chunks: Buffer[] = []
    const output = this.stream(command)
    let next = await output.next()
    while (next.done !== true) {
      chunks.push(next.value)
      next = await output.next()
    }
    return { code: next.value, stdout: Buffer.concat(chunks) }
  }

  /** Standard output as it arrives; the exit code is the return value. Stopping early stops the process. */
  async *stream(command: GitCommand): AsyncGenerator<Buffer, number, undefined> {
    const { executable } = this.#options
    const timeoutMs = command.network
      ? this.#options.networkTimeoutMs
      : this.#options.localTimeoutMs
    const maxOutputBytes = command.maxOutputBytes ?? this.#options.maxOutputBytes
    const secrets = credentialSecrets(command.network?.credential ?? null)
    const name = command.subcommand

    const child = spawn(executable, [name, ...(command.args ?? [])], {
      cwd: command.cwd,
      env: this.#environment(command),
      stdio: ['pipe', 'pipe', 'pipe'],
      signal:
        command.deadline === undefined
          ? AbortSignal.timeout(timeoutMs)
          : AbortSignal.any([AbortSignal.timeout(timeoutMs), command.deadline.signal]),
      windowsHide: true,
    })
    // `null` when a signal ended it; reported as such rather than mistaken for an answer.
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    // Handled below; this only stops an early rejection being reported as unhandled.
    closed.catch(ignore)
    const stderr = boundedText(child.stderr)
    // A command that exits before reading its input closes the pipe under the write.
    child.stdin.on('error', ignore)
    child.stdin.end(command.stdin)

    let finished = false
    try {
      let written = 0
      for await (const chunk of child.stdout) {
        // No encoding was set, so the stream yields bytes.
        const bytes: Buffer = chunk
        written += bytes.byteLength
        if (written > maxOutputBytes) {
          throw new ExternalSourceError(
            'output-too-large',
            `git ${name} wrote more than ${maxOutputBytes} bytes`,
          )
        }
        yield bytes
      }
      const code = await closed
      if (code === null || (code !== 0 && !(command.answers ?? []).includes(code))) {
        const detail = redact(stderr().trim(), secrets).slice(0, MESSAGE_LIMIT)
        throw new ExternalSourceError(
          'command-failed',
          `git ${name} failed (exit ${String(code)}): ${detail}`,
        )
      }
      finished = true
      return code
    } catch (error) {
      throw translate(error, name, timeoutMs, secrets, command.deadline)
    } finally {
      if (!finished) {
        child.kill()
        // Gone before the caller moves on, so nothing still holds its directory or its pipes.
        await closed.catch(ignore)
      }
    }
  }

  #environment(command: GitCommand): Record<string, string> {
    const { home, ceiling, allowFileProtocol, egressProxy } = this.#options
    const config: [string, string][] = [
      ['protocol.allow', 'never'],
      ['protocol.https.allow', 'always'],
      ...(allowFileProtocol ? [['protocol.file.allow', 'always'] satisfies [string, string]] : []),
      ['core.hooksPath', NULL_DEVICE],
      ['core.fsmonitor', 'false'],
      // An empty value clears the helper list, whatever configured it.
      ['credential.helper', ''],
      // A redirect would carry the credential to a host nobody checked.
      ['http.followRedirects', 'false'],
      ['submodule.recurse', 'false'],
      ['fetch.recurseSubmodules', 'false'],
      // Automatic housekeeping detaches background processes nothing here waits for.
      ['gc.auto', '0'],
      ['maintenance.auto', 'false'],
      ...(egressProxy === undefined
        ? []
        : [['http.proxy', egressProxy] satisfies [string, string]]),
    ]
    const credential = command.network?.credential ?? null
    if (credential !== null) config.push(['http.extraHeader', authorization(credential)])

    return {
      ...passThrough(),
      HOME: home,
      GIT_CEILING_DIRECTORIES: ceiling,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: NULL_DEVICE,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_LFS_SKIP_SMUDGE: '1',
      // Paths are literal prefixes, never patterns.
      GIT_LITERAL_PATHSPECS: '1',
      // Messages in a known language, so a failure reads the same in every log.
      LC_ALL: 'C',
      ...(command.network ? {} : { GIT_NO_LAZY_FETCH: '1' }),
      GIT_CONFIG_COUNT: String(config.length),
      ...Object.fromEntries(
        config.flatMap(([key, value], index) => [
          [`GIT_CONFIG_KEY_${index}`, key],
          [`GIT_CONFIG_VALUE_${index}`, value],
        ]),
      ),
    }
  }
}

function ignore(): void {}

/**
 * The few variables a process needs to start at all: where executables are,
 * and on Windows the system root (without it, sockets cannot be opened) and
 * the temporary directory.
 */
function passThrough(): Record<string, string> {
  const names = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR']
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
}

function authorization({ username, password }: SourceCredential): string {
  return `Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

/** What must never appear in a message: the password, and the header that encodes it. */
function credentialSecrets(credential: SourceCredential | null): readonly string[] {
  if (credential === null) return []
  return [
    credential.password,
    authorization(credential).replace('Authorization: Basic ', ''),
  ].filter((secret) => secret.length > 0)
}

function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((redacted, secret) => redacted.replaceAll(secret, '[redacted]'), text)
}

function boundedText(stream: NodeJS.ReadableStream): () => string {
  const chunks: Buffer[] = []
  let size = 0
  stream.on('data', (chunk: Buffer) => {
    if (size < STDERR_LIMIT) {
      chunks.push(chunk)
      size += chunk.byteLength
    }
  })
  return () => Buffer.concat(chunks).toString('utf8')
}

/**
 * What reaches the catch is one of this module's own refusals, or the
 * process's `error` event: the timeout's abort, or a failure to start it.
 */
function translate(
  error: unknown,
  name: string,
  timeoutMs: number,
  secrets: readonly string[],
  deadline: Deadline | undefined,
): ExternalSourceError {
  if (error instanceof ExternalSourceError) return error
  if (error instanceof Error && error.name === 'AbortError') {
    return new ExternalSourceError(
      'timeout',
      deadline?.signal.aborted === true
        ? `git ${name} was stopped: ${deadline.description}`
        : `git ${name} did not finish within ${timeoutMs} ms`,
    )
  }
  return new ExternalSourceError(
    'git-unavailable',
    `git could not be run: ${redact(String(error), secrets)}`,
  )
}
