import { useEffect, useState } from 'react'

declare function subscribe(cb: () => void): () => void

export function Widget() {
  const [count, setCount] = useState(0)
  // subscribes to the ticker
  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setCount(1)
    })
    return unsubscribe
  }, [])
  return count
}

export function Ticker() {
  // polls the heartbeat endpoint
  useEffect(() => {
    const id = setInterval(() => {}, 1000)
    return () => clearInterval(id)
  }, [])
  return null
}
