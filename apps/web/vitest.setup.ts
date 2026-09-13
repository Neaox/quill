import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

import { installBrowserShims, resetObservers } from './testing/browser-shims.ts'

// Registered explicitly rather than relying on Testing Library's automatic
// cleanup, which only installs itself when the global `afterEach` happens to
// exist at import time.
afterEach(cleanup)

// Testing Library gives a `findBy*` one second to resolve, which is its own
// budget and not Vitest's. That is plenty for a render and nowhere near
// enough on a machine running the whole suite in parallel under coverage,
// where a jsdom worker can lose a second to nothing in particular — and a
// query that never resolves still fails, five seconds later, with the same
// message.
configure({ asyncUtilTimeout: 5000 })

// The reading surface subscribes to an `IntersectionObserver`, and the editor
// measures the document it is laying out; jsdom implements neither. See
// `testing/browser-shims.ts`.
installBrowserShims()
afterEach(resetObservers)
