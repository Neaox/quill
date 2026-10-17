import { createHash } from 'node:crypto'

import { PUBLIC_PREVIEW_SCOPE } from '@quill/application'
import type { LinkPreviewAudience, LinkPreviewAudiences } from '@quill/application'
import { DEFAULT_LINK_PREVIEW_POLICY, compileLinkPolicy } from '@quill/domain'
import type { LinkPreviewPolicy, UserId } from '@quill/domain'

/**
 * Whose rules a link preview is made and shown under (ADR-042).
 *
 * The scope a snapshot is stored in is **derived from the policy**, not from
 * an organisation id. A preview fetched under the default policy is the same
 * for everyone and lives in the shared `public` scope. A preview fetched under
 * a restrictive one (an allow list, a block list, text-only) may differ from
 * what the default would give, so it lives in a scope named for that exact
 * policy: everyone whose policy is the same shares it, nobody else is ever
 * shown it, and changing the policy moves an organisation to a new scope with
 * no migration and no way to read what the old one stored.
 *
 * Where a person's policy comes from (the organisation's settings; see
 * `application/link-settings.ts`) is the `policyFor` function, and the public
 * site's is `publicPolicy`. The public site is held to the same rules as the
 * members and reads the same scope, so it can never draw a preview fetched
 * under a looser policy than the organisation's own. With no function given,
 * every organisation gets the default.
 */

export type PolicyFor = (userId: UserId) => Promise<LinkPreviewPolicy>
export type PublicPolicy = () => Promise<LinkPreviewPolicy>

const SCOPE_PREFIX = 'policy:'
const REMEMBERED_POLICIES = 64

function isUnrestricted(policy: LinkPreviewPolicy): boolean {
  return policy.mode === 'rich' && policy.allow.length === 0 && policy.block.length === 0
}

/** The same policy written in a different order is the same policy. */
function canonical(policy: LinkPreviewPolicy): string {
  return JSON.stringify({
    mode: policy.mode,
    allow: policy.allow.map((pattern) => pattern.trim().toLowerCase()).toSorted(),
    block: policy.block.map((pattern) => pattern.trim().toLowerCase()).toSorted(),
  })
}

/** What a policy that cannot be compiled becomes: previews off. Failing closed, never open. */
const CLOSED: LinkPreviewPolicy = { mode: 'off', allow: [], block: [] }

export function createLinkPreviewAudiences(
  policyFor: PolicyFor = async () => DEFAULT_LINK_PREVIEW_POLICY,
  publicPolicy: PublicPolicy = async () => DEFAULT_LINK_PREVIEW_POLICY,
): LinkPreviewAudiences {
  // Compiling is cheap but not free, and most people share one of a few policies.
  const compiled = new Map<string, LinkPreviewAudience>()

  function audienceFor(policy: LinkPreviewPolicy): LinkPreviewAudience {
    const key = canonical(policy)
    const known = compiled.get(key)
    if (known !== undefined) return known

    const result = compileLinkPolicy(policy)
    const audience: LinkPreviewAudience = result.ok
      ? {
          scope: isUnrestricted(policy)
            ? PUBLIC_PREVIEW_SCOPE
            : `${SCOPE_PREFIX}${createHash('sha256').update(key).digest('hex').slice(0, 32)}`,
          policy: result.value,
        }
      : audienceFor(CLOSED)

    if (compiled.size >= REMEMBERED_POLICIES) compiled.clear()
    compiled.set(key, audience)
    return audience
  }

  return {
    async forPerson(userId) {
      return audienceFor(await policyFor(userId))
    },
    forPublic: async () => audienceFor(await publicPolicy()),
  }
}
