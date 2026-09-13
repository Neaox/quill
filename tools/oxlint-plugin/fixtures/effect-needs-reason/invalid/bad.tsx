import { useEffect } from 'react'

export function Widget() {
  useEffect(() => {
    document.title = 'hi'
  }, [])
  return null
}
