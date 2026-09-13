import { createPool, dropSchema } from './db.ts'

const pool = createPool()
await dropSchema(pool)
await pool.end()
console.log('spike_r5 schema dropped')
