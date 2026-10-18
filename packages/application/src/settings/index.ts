export type {
  OrganisationLogo,
  OrganisationSettings,
  SecretReference,
  SettingsIssue,
  SettingsValidation,
  WorkspaceSettings,
} from './documents.ts'
export {
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  ORGANISATION_SETTINGS_PATH,
  ORGANISATION_SETTINGS_VERSION,
  OrganisationSettingsSchema,
  parseOrganisationSettings,
  parseWorkspaceSettings,
  recommendedLayout,
  SECRET_NAME_PATTERN,
  SecretReferenceSchema,
  SETTINGS_VERSION,
  SYSTEM_WORKSPACE_ID,
  validateOrganisationSettings,
  WORKSPACE_SETTINGS_VERSION,
  validateWorkspaceSettings,
  WorkspaceSettingsSchema,
  workspaceSettingsPath,
} from './documents.ts'

export type { Layout, LayoutSlot } from './layout.ts'
export { LAYOUT_CHOICES, LAYOUT_SLOTS, LayoutSchema } from './layout.ts'

export type { EffectiveSettings } from './resolve.ts'
export { resolveEffectiveSettings } from './resolve.ts'

export type { SettingsDecode } from './yaml.ts'
export { decodeOrganisationSettings, decodeWorkspaceSettings, encodeSettings } from './yaml.ts'

export type { PublicMenu, PublicMenuGroup, PublicMenuItem, PublicMenuLink } from './public-menu.ts'
export {
  MAX_PUBLIC_MENU_GROUP_LINKS,
  MAX_PUBLIC_MENU_ITEMS,
  MAX_PUBLIC_MENU_LABEL_LENGTH,
  MAX_PUBLIC_MENU_URL_LENGTH,
  menuLinks,
  menuTargetIds,
  PUBLIC_MENU_URL_PATTERN,
  PublicMenuSchema,
} from './public-menu.ts'

export type { CustomEmojiEntry, EmojiMediaType, RenderedEmoji } from './emoji.ts'
export {
  CustomEmojiSchema,
  customEmojiByName,
  EMOJI_MEDIA_TYPES,
  EMOJI_URL_PREFIX,
  emojiFileName,
  emojiForFile,
  emojiUrl,
  labelEmoji,
  MAX_CUSTOM_EMOJI,
  MAX_EMOJI_BYTES,
  MAX_EMOJI_PIXELS,
} from './emoji.ts'

export type { LinkPatternIssue, LinkPreviewSettings } from './link-previews.ts'
export {
  DEFAULT_LINK_PREVIEW_SETTINGS,
  LinkPreviewSettingsSchema,
  linkPatternIssues,
  linkPolicyOf,
  resolveLinkPreviewSettings,
} from './link-previews.ts'
