import { Button } from '@quill/ui'

export interface SettingsSaveButtonProps {
  /** On a phone's action bar: the 44-pixel touch size rather than the top bar's small one. */
  readonly compact: boolean
  readonly dirty: boolean
  readonly pending: boolean
  readonly onSave: () => void
}

/**
 * A settings screen's Save: disabled until something has changed, busy while
 * the write is in flight, and sized for where it is shown — the page's top
 * bar on a desktop, the `SettingsActionBar` on a phone.
 */
export function SettingsSaveButton({ compact, dirty, pending, onSave }: SettingsSaveButtonProps) {
  return (
    <Button size={compact ? 'xl' : 'sm'} loading={pending} disabled={!dirty} onClick={onSave}>
      Save
    </Button>
  )
}
