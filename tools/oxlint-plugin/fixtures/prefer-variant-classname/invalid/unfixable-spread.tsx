declare function cx(...args: unknown[]): string
declare function buttonStyles(props: { variant?: string }): string

export function Widget({ className, rest }: { className?: string; rest: { variant?: string } }) {
  return <button className={cx(buttonStyles({ ...rest }), className)}>go</button>
}
