import { BRAND } from '@quill/brand'

export function describe(): string {
  return `${BRAND.name} workspace`
}

export const command = 'pnpm --filter @quill/web dev'
