import { setSecret } from '@quill/application'
import type { SetSecretResult } from '@quill/application'
import type { UserId } from '@quill/domain'

import type { AppDependencies } from '../dependencies.ts'

/**
 * `pnpm --filter @quill/server secrets:set <name>` — how an administrator
 * enters a secret ADR-034 asks for: an OIDC client secret, an SMTP password,
 * a webhook signing key. The name is the only thing `argv` ever sees; the
 * value is read from stdin (`secrets-set-cli.ts`) and never appears in
 * `argv`, where it would sit in shell history and in this or any other
 * process's list of running commands — `parseSecretsSetArgv` refuses a
 * second argument outright rather than silently accepting a value there.
 *
 * A script rather than a settings-screen button because it is what this
 * migration needs first: an operator moving `OIDC_<ID>_CLIENT_SECRET` and
 * `SMTP_PASS` out of the environment, once, before the fallback that reads
 * them is removed in a later release.
 */

export interface SetSecretOutput {
  (line: string): void
}

/** What `secrets-set-cli.ts` uses to choose its exit code. */
export type SetSecretOutcome = SetSecretResult['kind']

const USAGE =
  'Usage: pnpm --filter @quill/server secrets:set <name>, with the value piped or redirected ' +
  'into stdin.'

export type ParsedSecretsSetArgv =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string }

/**
 * `argv` is `process.argv.slice(2)` — everything after the script name. A
 * second argument is refused rather than ignored: `secrets:set <name>
 * <value>` would otherwise silently accept the value on the command line,
 * which is the one thing this command exists to avoid — it sits in shell
 * history and in this process's own argument list (visible to `ps`) for as
 * long as the command runs.
 */
export function parseSecretsSetArgv(argv: readonly string[]): ParsedSecretsSetArgv {
  const [name, ...rest] = argv
  if (name === undefined || name.length === 0) {
    return { ok: false, message: USAGE }
  }
  if (rest.length > 0) {
    return {
      ok: false,
      message:
        'secrets:set takes the value from stdin, never from a command-line argument. Pipe or ' +
        'redirect it instead: pnpm --filter @quill/server secrets:set <name> < /path/to/secret-file',
    }
  }
  return { ok: true, name }
}

/** The shape `process.stdin` and a test's fake both satisfy. */
export interface StdinLike {
  readonly isTTY?: boolean
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>
}

export type ReadSecretValueResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string }

/**
 * Reads the value from stdin — never a prompt, which would echo it, and
 * never `argv` (`parseSecretsSetArgv`). A terminal stdin is refused outright
 * rather than left to block: typing a secret at a prompt this command never
 * offered would otherwise hang until interrupted, by which point the value
 * is already in `~/.bash_history` from the command that got it there.
 */
export async function readSecretValue(stdin: StdinLike): Promise<ReadSecretValueResult> {
  if (stdin.isTTY === true) {
    return {
      ok: false,
      message:
        'stdin is a terminal: secrets:set reads the value from a pipe or a redirect, never by ' +
        'typing it in. Try: pnpm --filter @quill/server secrets:set <name> < /path/to/secret-file',
    }
  }
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk))
  // A single trailing newline is the shell's, not the secret's — `echo` and
  // most editors add exactly one. Anything else in the value is kept as read.
  const value = Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '')
  return { ok: true, value }
}

export async function setSecretValue(
  deps: AppDependencies,
  name: string,
  value: string,
  actor: UserId,
  write: SetSecretOutput,
): Promise<SetSecretOutcome> {
  const result = await setSecret(deps, { name, value, actor })
  switch (result.kind) {
    case 'set':
      write(`Set secret "${name}" (key ${result.secret.keyId}).`)
      break
    case 'invalid-name':
      write(
        `"${name}" is not a valid secret name: lower-case, path-like segments such as ` +
          '"oidc/entra/client-secret" (see SECRET_NAME_PATTERN).',
      )
      break
    case 'invalid-value':
      write(
        result.reason === 'empty'
          ? 'The value read from stdin was empty; nothing was stored.'
          : 'The value read from stdin is too long; nothing was stored.',
      )
      break
  }
  return result.kind
}
