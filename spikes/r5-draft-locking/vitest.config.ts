import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // All test files share one Postgres schema (spike_r5) and truncate it in beforeEach.
    // Running files in parallel would let one file's truncate wipe another file's fixtures
    // mid-test, so force files to run one at a time. Tests within a file already run
    // sequentially by default.
    fileParallelism: false,
  },
})
