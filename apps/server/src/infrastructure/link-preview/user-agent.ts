import { BRAND } from '@quill/brand'

/**
 * How Quill introduces itself to a site it fetches for a preview (ADR-042):
 * `<Brand>Bot/<version> (+<instance URL>/bot)`.
 *
 * Honest by design. The site's owner sees who is asking and where to read what
 * is fetched and how to opt out, which is the courtesy a crawler owes and what
 * lets a site decide for itself. The instance's own address is in it, so a
 * request can be traced to the installation that made it.
 *
 * The version is the behaviour a site may rely on, not the release: it changes
 * when what the bot fetches or how it identifies itself does.
 */
export const BOT_VERSION = '1'

export function linkPreviewUserAgent(appUrl: string): string {
  const origin = new URL(appUrl).origin
  return `${BRAND.name}Bot/${BOT_VERSION} (+${origin}/bot)`
}
