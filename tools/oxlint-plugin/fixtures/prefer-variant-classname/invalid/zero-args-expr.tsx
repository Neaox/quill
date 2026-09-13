declare function cx(...args: unknown[]): string
declare const styles: { root: (props?: { className?: string }) => string }

export function Widget({ props }: { props: { className: string } }) {
  return <div className={cx(styles.root(), props.className)}>go</div>
}
