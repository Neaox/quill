import { parentPort, workerData } from 'node:worker_threads'

/**
 * A document worker for the pool's tests: it answers `inspect` with a fixed
 * inspection, and stops its own thread on the item `crash`, either every
 * time or only the first time across all threads (a shared counter); it
 * answers `throw` with the error a format that throws sends, and `odd`
 * with something that is not an inspection.
 */

/* v8 ignore start -- runs in a worker thread, which coverage does not follow. */
const port = parentPort
if (port === null) throw new Error('Runs only in a worker thread.')
const settings: { readonly extensions: string; readonly crashes: Int32Array } = workerData

port.on('message', (task: { readonly id: number; readonly item: unknown }) => {
  if (task.item === 'crash' && Atomics.add(settings.crashes, 0, -1) > 0) process.exit(1)
  if (task.item === 'throw') {
    port.postMessage({ id: task.id, error: 'The format threw.' })
    return
  }
  if (task.item === 'odd') {
    port.postMessage({ id: task.id, value: 'not an inspection' })
    return
  }
  port.postMessage({
    id: task.id,
    value: { view: { frontMatter: {}, title: String(task.item) }, links: [] },
  })
})
port.postMessage({ ready: settings.extensions })
/* v8 ignore stop */
