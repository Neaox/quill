/**
 * A URL-safe slug from a title, for the "New document" dialog
 * (`features/workspaces/new-document-dialog.tsx`). Lowercased, non-alphanumeric
 * runs collapsed to one hyphen, no leading or trailing hyphen.
 */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
