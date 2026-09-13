declare function cx(...args: unknown[]): string
declare const tabsStyles: () => { root: (props?: { className?: string }) => string }

export function Widget({ bodyClassName }: { bodyClassName?: string }) {
  return <div className={cx(tabsStyles().root(), bodyClassName)}>go</div>
}
