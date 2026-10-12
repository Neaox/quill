/**
 * Drafts and locking on the client (ADR-021, research R5): the lock state machine,
 * the hooks that drive it, and the recovery buffer that keeps an unsent edit until
 * the server acknowledges it.
 */
export type { Clock, FakeClock } from './clock.ts'
export { createFakeClock, systemClock } from './clock.ts'
export type {
  AcquireResult,
  DocumentAst,
  DraftClient,
  DraftSaveResult,
  HeartbeatResult,
  LoadedDraft,
  Lock,
  LockClient,
  LockHolder,
  TakeoverResult,
} from './clients.ts'
export type { DraftBase, PendingDraft, RecoveryStore } from './recovery-store.ts'
export { createMemoryRecoveryStore } from './recovery-store.ts'
export type { LockEvent, LockState, LockStatus } from './lock-machine.ts'
export { initialLockState, lockReducer } from './lock-machine.ts'
export type { DocumentLock, UseDocumentLockOptions } from './use-document-lock.ts'
export {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RETRY_BACKOFF,
  useDocumentLock,
} from './use-document-lock.ts'
export type { AutosavePhase, AutosaveStatus } from './autosave-machine.ts'
export type { Autosave, UseAutosaveOptions } from './use-autosave.ts'
export { AUTOSAVE_DEBOUNCE_MS, useAutosave } from './use-autosave.ts'
export type { Connectivity, FakeConnectivity } from './connectivity.ts'
export { browserConnectivity, createFakeConnectivity } from './connectivity.ts'
export type { DraftChannel, DraftSavedMessage } from './draft-channel.ts'
export { createBroadcastDraftChannel, createMemoryDraftChannels } from './draft-channel.ts'
export { useUnsavedChangesGuard } from './use-unsaved-changes-guard.ts'
