declare function cx(...args: unknown[]): string
declare const styles: { root: (props: { variant: string }) => string }

export function Widget({ className, props }: { className?: string; props: { variant: string } }) {
  return <div className={cx(styles.root(props), className)}>go</div>
}
