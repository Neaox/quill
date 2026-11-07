import { createFileRoute } from '@tanstack/react-router'

import { DesignPage } from '../features/design/design-page.tsx'

/**
 * The design showcase is a development surface, not part of reading a
 * document, and it pulls in every specimen, every contrast table, and the
 * tokenizer chunk behind them. The router plugin's `autoCodeSplitting` puts
 * this component in its own chunk, which is what keeps the reading route's
 * first load inside the budget of quill-plan.md section 31.
 *
 * It shows each built-in identity as it ships, chosen with its own switcher,
 * so the organisation's theme is not applied here: both write `data-theme-id`
 * on `<html>`, and with both on the page the identity shown depended on which
 * wrote last.
 */
export const Route = createFileRoute('/design')({
  staticData: { builtInIdentitiesOnly: true },
  head: () => ({ meta: [{ title: 'Design' }] }),
  component: DesignPage,
})
