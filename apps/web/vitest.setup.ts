import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

import { installBrowserShims, resetObservers } from './testing/browser-shims.ts'

// Registered explicitly rather than relying on Testing Library's automatic
// cleanup, which only installs itself when the global `afterEach` happens to
// exist at import time.
afterEach(cleanup)

// The reading surface subscribes to an `IntersectionObserver`, and the editor
// measures the document it is laying out; jsdom implements neither. See
// `testing/browser-shims.ts`.
installBrowserShims()
afterEach(resetObservers)
