declare function cx(...args: unknown[]): string
declare const styles: { root: (props?: { className?: string }) => string }

export function Widget({ className, fallback }: { className?: string; fallback: string }) {
  return <div className={cx(styles.root({ className: fallback }), className)}>go</div>
}
