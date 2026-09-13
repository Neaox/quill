/**
 * The workspace mark and the account avatar from the artboard.
 *
 * Both are decorative: the header is named by its landmark and the rail's
 * account control by its own label, so neither shape has to say anything.
 */

export function WorkspaceMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-5.5 items-center justify-center rounded-sm bg-foreground"
    >
      <span className="size-3 rounded-[2px] border-2 border-accent" />
    </span>
  )
}

export function Avatar({ initials = 'MR' }: { readonly initials?: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6.5 items-center justify-center rounded-full bg-surface font-mono text-2xs text-muted"
    >
      {initials}
    </span>
  )
}
