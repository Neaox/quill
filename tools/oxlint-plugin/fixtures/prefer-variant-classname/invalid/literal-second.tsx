declare function cx(...args: unknown[]): string
declare const styles: { root: (props?: { className?: string }) => string }

export function Widget() {
  return <div className={cx(styles.root(), 'always-visible')}>go</div>
}
