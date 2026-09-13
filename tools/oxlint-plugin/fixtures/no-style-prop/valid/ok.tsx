export function Widget({ x }: { x: number }) {
  return <div style={{ '--offset': `${x}px` }}>hi</div>
}
