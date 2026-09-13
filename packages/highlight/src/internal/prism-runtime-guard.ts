/**
 * Runs before `prismjs`'s own module body does. Prism core reads
 * `Prism.manual` and `Prism.disableWorkerMessageHandler` off whatever global
 * `Prism` object already exists at its own init, to decide whether to
 * auto-highlight the page on load and whether to install a worker message
 * listener. Neither behaviour belongs to a tokenizer that only ever runs on
 * the server or is invoked explicitly (grammars.ts, the only module that
 * imports "prismjs"), so both are disabled here.
 *
 * This has to live in its own module: ES imports resolve and evaluate whole
 * dependency subgraphs before the importing module's own statements run, so
 * a plain assignment written between two `import` lines in the same file
 * would still run after both, too late for Prism to see it. An earlier
 * module's own body is the only thing guaranteed to finish first.
 */
const scope = globalThis as { Prism?: { manual?: boolean; disableWorkerMessageHandler?: boolean } }
scope.Prism = { ...scope.Prism, manual: true, disableWorkerMessageHandler: true }

/** Marks this module as already applied; grammars.ts imports it for the side effect above. */
export const prismRuntimeGuardApplied = true
