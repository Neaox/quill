declare function cx(...args: unknown[]): string
declare function buttonStyles(props: { variant: string }): string

export function Widget({ className, variant }: { className?: string; variant: string }) {
  return <button className={cx(buttonStyles({ variant }), className)}>go</button>
}
