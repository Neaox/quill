declare function cx(...args: unknown[]): string
declare function buttonStyles(props?: { variant?: string }): string
declare function otherStyles(props?: { tone?: string }): string
declare const styles: { root: (props?: { className?: string }) => string }

export function Widget({ className, variant }: { className?: string; variant?: string }) {
  return (
    <div className={cx('a', 'b')}>
      <span className={cx('rounded-sm text-muted', className)}>literal first argument</span>
      <p className={cx(buttonStyles({ variant }), otherStyles({ tone: 'info' }))}>
        merging two variant results
      </p>
      <em className={cx(buttonStyles(), 'a', 'b')}>three or more arguments</em>
      <strong className={styles.root({ className })}>the preferred direct form</strong>
    </div>
  )
}
