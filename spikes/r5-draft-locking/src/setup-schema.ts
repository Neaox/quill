import { createPool, setupSchema } from './db.ts'

const pool = createPool()
await setupSchema(pool)
await pool.end()
console.log('spike_r5 schema ready')
