import { serveMerges } from '@quill/markdown/merge-worker'

/**
 * The module worker a long document's offline merge runs in
 * (`merge-runner.ts`). It holds the merge engine and nothing else.
 */
serveMerges(globalThis)
