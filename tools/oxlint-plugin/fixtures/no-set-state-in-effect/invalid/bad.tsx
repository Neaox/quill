import { useEffect, useState } from 'react'

export function Widget() {
  const [count, setCount] = useState(0)
  // subscribes to the ticker
  useEffect(() => {
    setCount(1)
  }, [])
  return count
}
