/**
 * Test support: fakes for every port, so a use case can be driven without a
 * database, a repository, or a Markdown parser. Imported by this package's
 * own tests and by the server's unit tests, which stand up the same fakes.
 */
export type { InMemoryUnitOfWork } from './in-memory-repositories.ts'
export { createInMemoryUnitOfWork } from './in-memory-repositories.ts'
export type { FakeContentStore, FakeContentStoreOptions } from './fake-content-store.ts'
export { createFakeContentStore } from './fake-content-store.ts'
export type { FakeDocumentFormatOptions } from './fake-document-format.ts'
export { createFakeDocumentFormat, serialise } from './fake-document-format.ts'
export type { FakeClock } from './fakes.ts'
export { aShortId, createFakeClock, createFakeHasher, createFakeIdGenerator } from './fakes.ts'
