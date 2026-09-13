import { useEffect } from 'react'

export function Widget() {
  // synchronises with the browser's title bar
  useEffect(() => {
    document.title = 'hi'
  }, [])
  return null
}
