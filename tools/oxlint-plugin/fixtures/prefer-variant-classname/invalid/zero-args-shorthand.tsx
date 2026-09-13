declare function cx(...args: unknown[]): string
declare function buttonStyles(): string

export function Widget({ className }: { className?: string }) {
  return <button className={cx(buttonStyles(), className)}>go</button>
}
