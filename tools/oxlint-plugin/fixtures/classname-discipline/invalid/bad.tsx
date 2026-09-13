export function Widget({ isOpen }: { isOpen: boolean }) {
  return <div className={isOpen ? 'open' : 'closed'}>hi</div>
}
