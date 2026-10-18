/**
 * The link a peek is for, given the node an event came from (ADR-042).
 *
 * Only a link that leaves the application is previewed. A link to another
 * document of the same instance is already a page the reader can open, a link
 * into the page goes nowhere new, and a mail link has no page to show. A
 * heading's own anchor and a card are left alone: the first is furniture, and
 * the second already shows everything a peek would, and so does an embed's caption.
 */
export function peekTarget(node: EventTarget | null, article: Element): HTMLAnchorElement | null {
  if (!(node instanceof Element)) return null
  const anchor = node.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement) || !article.contains(anchor)) return null
  if (anchor.matches('.heading-anchor, .link-card, .link-embed-caption a')) return null
  const { protocol, origin } = anchor
  if (protocol !== 'http:' && protocol !== 'https:') return null
  return origin === anchor.ownerDocument.location.origin ? null : anchor
}
