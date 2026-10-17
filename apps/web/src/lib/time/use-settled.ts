import { useEffect, useState } from 'react'

/**
 * `value`, once it has stopped changing for `delayMs`; until then, what it last settled
 * on. For work that follows something being typed (a summary of what a draft says) and
 * should not start again on every save of it. The first value is taken as it is.
 */
export function useSettled<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value)

  // Synchronises with a timer, the external system that makes "stopped changing" observable.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value)
    }, delayMs)
    return () => {
      clearTimeout(timer)
    }
  }, [value, delayMs])

  return settled
}
