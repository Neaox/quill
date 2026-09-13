import type { MagicLinkPurpose } from '@quill/application'

export interface MagicLinkEmail {
  readonly to: string
  readonly url: string
  readonly purpose: MagicLinkPurpose
}

export interface AccountExistsEmail {
  readonly to: string
  /** Where the recipient should go instead: the sign-in page. */
  readonly signInUrl: string
}

/** The boundary between auth flows and however mail actually gets delivered (plan §23). */
export interface Mailer {
  sendMagicLink(email: MagicLinkEmail): Promise<void>
  /**
   * "Someone tried to create an account with this address, and you already
   * have one." Sign-up answers the same way whether or not the email is
   * known (ADR-011, no enumeration), so this is how the person who actually
   * owns the address finds out — out of band, where an attacker cannot see it.
   */
  sendAccountExists(email: AccountExistsEmail): Promise<void>
}
