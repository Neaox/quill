/**
 * The boundary between the platform and somebody else's directory
 * (ADR-011, "Enterprise single sign-on").
 *
 * There is exactly one OIDC implementation; a provider — Microsoft Entra ID,
 * Google Workspace, Amazon Cognito, Auth0, anything discovery can describe —
 * is a data preset behind it, never a code path. Everything above this port
 * is identical for every provider: linking, provisioning, policy, session
 * issuance, and audit all read a `FederatedIdentity` and nothing else.
 *
 * Nothing here carries a token. `start` hands back the three secrets the
 * caller must keep for the round trip (the `state` and `nonce` it will check,
 * and the PKCE verifier it will spend), and `complete` hands back claims. The
 * authorisation code, the access token, and the id token stay inside the
 * adapter, which is what "tokens are never stored in the browser" means on
 * this side of the wire.
 */

/** Who the provider says this is. `claims` is for the audit log, and holds no token. */
export interface FederatedIdentity {
  readonly issuer: string
  /** The provider's own immutable key for this person. Identity is `(issuer, subject)`, never email. */
  readonly subject: string
  readonly email: string | null
  /** Whether the provider *asserts* the address. Linking requires it (ADR-011). */
  readonly emailVerified: boolean
  readonly displayName: string | null
  readonly groups: readonly string[]
  readonly claims: Readonly<Record<string, unknown>>
}

/** The secrets one sign-in attempt is bound to, minted by `start` and spent by `complete`. */
export interface SignInBinding {
  readonly state: string
  readonly nonce: string
  readonly codeVerifier: string
}

/** Everything the caller needs to send the browser onwards, and to recognise it coming back. */
export interface StartedSignIn extends SignInBinding {
  readonly authorizationUrl: string
}

/**
 * Why a sign-in did not complete. The caller answers the browser identically
 * whichever of these it is (ADR-011: no account enumeration) and records the
 * distinction in the audit log, where only an operator can read it.
 */
export type FederatedSignInFailure =
  /** Discovery, JWKS, or the token endpoint could not be reached or did not answer usefully. */
  | 'provider_unavailable'
  /** The provider refused the code, the PKCE verifier, or the client credentials. */
  | 'token_exchange_failed'
  /** The id token was absent, malformed, signed by an unknown key, or failed issuer/audience/expiry/nonce. */
  | 'invalid_token'
  /** The token verified, but a preset's claim check failed: a wrong tenant, a wrong hosted domain. */
  | 'claim_rejected'

export type StartSignInResult =
  | ({ readonly ok: true } & StartedSignIn)
  | {
      readonly ok: false
      readonly reason: 'provider_unavailable'
      readonly detail: string
    }

export type CompleteSignInResult =
  | { readonly ok: true; readonly identity: FederatedIdentity }
  | {
      readonly ok: false
      readonly reason: FederatedSignInFailure
      /** One short line for the audit row. Never a token, a code, or a secret. */
      readonly detail: string
    }

export interface IdentityProvider {
  /** The configured id: what `/api/auth/oidc/:id/start` names and what an identity row records. */
  readonly id: string
  /** What the sign-in button says: "Continue with Microsoft". */
  readonly displayName: string
  /**
   * Builds the authorisation request for one attempt. The returned binding is
   * the caller's to keep for the round trip; this port keeps no state at all,
   * so two browsers signing in at once cannot collide.
   */
  start(): Promise<StartSignInResult>
  /** Spends the code from the callback against the binding `start` handed out. */
  complete(input: { readonly code: string } & SignInBinding): Promise<CompleteSignInResult>
}
