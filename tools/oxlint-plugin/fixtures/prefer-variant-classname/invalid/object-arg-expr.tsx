declare function cx(...args: unknown[]): string
declare const styles: { root: (props?: { size?: string; className?: string }) => string }

export function Widget({ bodyClassName, size }: { bodyClassName?: string; size?: string }) {
  return <div className={cx(styles.root({ size }), bodyClassName)}>go</div>
}
