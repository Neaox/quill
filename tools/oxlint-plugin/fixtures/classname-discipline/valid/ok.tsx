declare function cx(...args: unknown[]): string
declare function button(props: { variant: string }): string

export function Widget({ className }: { className?: string }) {
  return (
    <div className="a b">
      <span className={cx('a', 'b')}>x</span>
      <button className={cx(button({ variant: 'primary' }), className)}>y</button>
    </div>
  )
}
