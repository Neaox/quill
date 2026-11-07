/**
 * The hardened runner, driven with Node standing in for `git`: the runner
 * adds nothing to the arguments, so a script can report exactly the
 * environment and arguments a real `git` would have been given, and can
 * misbehave (hang, flood, fail) on demand.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExternalSourceError } from '@quill/application'
import { afterAll, describe, expect, it } from 'vitest'

import { GitCli } from './git-cli.ts'
import type { GitCliOptions, GitCommand } from './git-cli.ts'

const directory = await mkdtemp(join(tmpdir(), 'quill-git-cli-'))
afterAll(() => rm(directory, { recursive: true, force: true, maxRetries: 5 }))

const TOKEN = 'ghs_example-installation-token'
const CREDENTIAL = { username: 'x-access-token', password: TOKEN }
const ENCODED = Buffer.from(`x-access-token:${TOKEN}`).toString('base64')

function cli(options: Partial<GitCliOptions> = {}): GitCli {
  return new GitCli({
    executable: process.execPath,
    home: directory,
    ceiling: directory,
    localTimeoutMs: 20_000,
    networkTimeoutMs: 20_000,
    maxOutputBytes: 1024 * 1024,
    allowFileProtocol: false,
    ...options,
  })
}

function script(source: string, command: Partial<GitCommand> = {}): GitCommand {
  return { subcommand: '-e', args: [source], cwd: directory, ...command }
}

const REPORT = 'process.stdout.write(JSON.stringify({ env: process.env, argv: process.argv }))'

interface Report {
  readonly env: Readonly<Record<string, string>>
  readonly argv: readonly string[]
}

async function report(git: GitCli, command: Partial<GitCommand> = {}): Promise<Report> {
  const { stdout } = await git.run(script(REPORT, command))
  const parsed: Report = JSON.parse(stdout.toString('utf8'))
  return parsed
}

function configOf(env: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const count = Number(env['GIT_CONFIG_COUNT'])
  return new Map(
    Array.from({ length: count }, (_, index) => [
      env[`GIT_CONFIG_KEY_${index}`] ?? '',
      env[`GIT_CONFIG_VALUE_${index}`] ?? '',
    ]),
  )
}

async function failure(promise: Promise<unknown>): Promise<ExternalSourceError> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ExternalSourceError))
    throw new Error(`expected a refusal, got ${String(error)}`)
  return error
}

describe('GitCli', () => {
  it('builds the environment from nothing: no inherited configuration, prompts, hooks or lazy fetches', async () => {
    process.env['QUILL_TEST_INHERITED'] = 'leaked'
    try {
      const { env } = await report(cli())
      const config = configOf(env)

      expect(env['QUILL_TEST_INHERITED']).toBeUndefined()
      expect(env).toMatchObject({
        HOME: directory,
        GIT_CEILING_DIRECTORIES: directory,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_LFS_SKIP_SMUDGE: '1',
        GIT_LITERAL_PATHSPECS: '1',
        GIT_NO_LAZY_FETCH: '1',
      })
      expect(Object.fromEntries(config)).toMatchObject({
        'protocol.allow': 'never',
        'protocol.https.allow': 'always',
        'core.hooksPath': '/dev/null',
        'credential.helper': '',
        'http.followRedirects': 'false',
        'submodule.recurse': 'false',
      })
      expect(config.has('protocol.file.allow')).toBe(false)
      expect(config.has('http.extraHeader')).toBe(false)
    } finally {
      delete process.env['QUILL_TEST_INHERITED']
    }
  })

  it('gives a network command the credential in its environment, never in its arguments', async () => {
    const { env, argv } = await report(
      cli({ allowFileProtocol: true, egressProxy: 'http://proxy.internal:3128' }),
      { network: { credential: CREDENTIAL } },
    )
    const config = configOf(env)

    expect(config.get('http.extraHeader')).toBe(`Authorization: Basic ${ENCODED}`)
    expect(config.get('http.proxy')).toBe('http://proxy.internal:3128')
    expect(config.get('protocol.file.allow')).toBe('always')
    // Lazy fetching is what `git backfill` is made of.
    expect(env['GIT_NO_LAZY_FETCH']).toBeUndefined()
    expect(argv.join(' ')).not.toContain(TOKEN)
    expect(argv.join(' ')).not.toContain(ENCODED)
  })

  it('sends no credential header when there is no credential', async () => {
    const { env } = await report(cli(), { network: { credential: null } })

    expect(configOf(env).has('http.extraHeader')).toBe(false)
  })

  it('passes standard input through', async () => {
    const { stdout } = await cli().run(
      script('process.stdin.pipe(process.stdout)', { stdin: 'abc123\n' }),
    )

    expect(stdout.toString('utf8')).toBe('abc123\n')
  })

  it('reports a failure with its exit code and what it wrote, the credential removed', async () => {
    const error = await failure(
      cli().run(
        script(
          // Two writes apart, so the second arrives after the kept text is full.
          `process.exitCode = 3; process.stderr.write(${JSON.stringify(`fatal: ${TOKEN} ${ENCODED} refused\n`)} + 'x'.repeat(20000)); setTimeout(() => process.stderr.write('y'.repeat(20000)), 100)`,
          { network: { credential: CREDENTIAL } },
        ),
      ),
    )

    expect(error.reason).toBe('command-failed')
    expect(error.message).toMatch(
      /^git -e failed \(exit 3\): fatal: \[redacted\] \[redacted\] refused/u,
    )
    expect(error.message).not.toContain(TOKEN)
    expect(error.message.length).toBeLessThan(1100)
  })

  it('treats an exit code the command answers with as an answer', async () => {
    const result = await cli().run(script('process.exit(1)', { answers: [1] }))

    expect(result.code).toBe(1)
  })

  it('stops a command that runs past its timeout', async () => {
    const error = await failure(
      cli({ localTimeoutMs: 300 }).run(script('setTimeout(() => {}, 60000)')),
    )

    expect(error.reason).toBe('timeout')
    expect(error.message).toContain('300 ms')
  })

  it('uses the network timeout for a network command', async () => {
    const error = await failure(
      cli({ networkTimeoutMs: 300 }).run(
        script('setTimeout(() => {}, 60000)', { network: { credential: null } }),
      ),
    )

    expect(error.reason).toBe('timeout')
  })

  it('stops a command that writes more than the cap', async () => {
    const error = await failure(
      cli({ maxOutputBytes: 1000 }).run(script("process.stdout.write('x'.repeat(5000))")),
    )

    expect(error.reason).toBe('output-too-large')
  })

  it('lets one command lift the cap when its caller bounds what it keeps', async () => {
    const { stdout } = await cli({ maxOutputBytes: 1000 }).run(
      script("process.stdout.write('x'.repeat(5000))", { maxOutputBytes: 10_000 }),
    )

    expect(stdout.byteLength).toBe(5000)
  })

  it('stops the process when the reader stops early', async () => {
    const output = cli().stream(script("setInterval(() => process.stdout.write('tick'), 10)"))

    for await (const chunk of output) {
      expect(chunk.byteLength).toBeGreaterThan(0)
      break
    }
  })

  it('says git could not be run when the executable is missing', async () => {
    const error = await failure(cli({ executable: join(directory, 'no-such-git') }).run(script('')))

    expect(error.reason).toBe('git-unavailable')
  })
})
