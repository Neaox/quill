/**
 * The design system.
 *
 * Tokens and stylesheets are exported from this package as `./styles.css`;
 * this module is the React surface. Everything here is owned by the project:
 * the primitives that need real accessibility machinery (focus trapping,
 * roving tab index, floating positioning) delegate to Radix Primitives
 * internally, but the API, the classes, and the states are ours, so swapping
 * the internals of one component never reaches a feature.
 *
 * Two kinds of component live here. **Primitives** — button, input, badge,
 * callout, tabs, dialog, tooltip, breadcrumb, table, code block — are the
 * vocabulary every surface is built from. **Signature components** — the
 * document shell, the tree, the revision timeline, the comments panel — are
 * the bounded set of variants a theme chooses between (ADR-028, layer 1);
 * each takes an explicit variant for previews and otherwise reads the
 * identity in scope. A feature composes both and restyles neither.
 */

/**
 * `tv` is exported configured (`docs/architecture/styling.md`): a feature that
 * declares its own variants uses this one, so the design system's custom
 * utilities merge there too.
 */
export { cx, tv, type ClassValue } from './lib/class-names.ts'

/**
 * The two layout measurements that exist in CSS and are also needed in
 * JavaScript. See `lib/metrics.ts`: the stylesheet is the source, and a test
 * holds these to it.
 */
export { ANCHOR_OFFSET_PX, SHELL_HEADER_HEIGHT_PX } from './lib/metrics.ts'

/**
 * The one link seam. Every primitive that renders a destination takes a
 * `linkComponent` of this type and describes where it goes with a
 * `LinkTarget`, so an application wires its router in once and the design
 * system never holds a built `href` (ADR-035).
 */
export {
  PlainLink,
  linkHref,
  type LinkComponent,
  type LinkRenderProps,
  type LinkTarget,
} from './lib/link.tsx'

export { Badge, type BadgeProps, type BadgeTone } from './components/badge.tsx'
export { Breadcrumb, type BreadcrumbItem, type BreadcrumbProps } from './components/breadcrumb.tsx'
export {
  Button,
  buttonClassName,
  type ButtonClassOptions,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/button.tsx'
export { Callout, type CalloutProps, type CalloutTone } from './components/callout.tsx'
export { CodeBlock, codeBlockStyles, type CodeBlockProps } from './components/code-block.tsx'
export {
  CommentsPanel,
  type CommentsPanelProps,
  type DocumentComment,
} from './components/comments-panel.tsx'
export { DataTable, type DataTableProps } from './components/data-table.tsx'
export { Dialog, DialogClose, type DialogProps } from './components/dialog.tsx'
export {
  DocumentHeader,
  type DocumentHeaderProps,
  type DocumentState,
  type DocumentStatus,
} from './components/document-header.tsx'
export { DocumentShell, type DocumentShellProps } from './components/document-shell.tsx'
export { IconRail, type IconRailItem, type IconRailProps } from './components/icon-rail.tsx'
export {
  ChevronRightIcon,
  CloseIcon,
  CommentIcon,
  CopyIcon,
  DangerIcon,
  HistoryIcon,
  InfoIcon,
  OutlineIcon,
  SearchIcon,
  SuccessIcon,
  WarningIcon,
  type IconProps,
} from './components/icons.tsx'
export { Input, type InputProps } from './components/input.tsx'
export { Menu, menuStyles, type MenuItem, type MenuProps } from './components/menu.tsx'
export {
  Block,
  LayoutGrid,
  type BlockProps,
  type BlockWidth,
  type LayoutGridProps,
} from './components/layout-grid.tsx'
export {
  Prose,
  ProseTable,
  proseTableStyles,
  type ProseProps,
  type ProseTableProps,
} from './components/prose.tsx'
export {
  PropertyReadout,
  PropertySelect,
  propertyReadoutStyles,
  propertySelectStyles,
  type PropertyReadoutProps,
  type PropertySelectOption,
  type PropertySelectProps,
} from './components/properties-field.tsx'
export {
  RevisionTimeline,
  type Revision,
  type RevisionTimelineProps,
} from './components/revision-timeline.tsx'
export {
  ScrollGroup,
  scrollGroupStyles,
  type ScrollGroupProps,
} from './components/scroll-group.tsx'
export {
  PresentBar,
  PresentHint,
  PresentKey,
  presentBarStyles,
  type PresentBarProps,
  type PresentHintProps,
  type PresentKeyProps,
} from './components/present-bar.tsx'
export {
  PresentGoTo,
  matchingSections,
  presentGoToStyles,
  type MatchedSection,
  type PresentGoToProps,
  type PresentGoToSection,
} from './components/present-go-to.tsx'
export {
  PresentProgress,
  presentProgressStyles,
  type PresentProgressProps,
} from './components/present-progress.tsx'
export {
  PresentRail,
  presentRailStyles,
  type PresentRailItem,
  type PresentRailProps,
} from './components/present-rail.tsx'
export {
  ProgressBar,
  progressBarStyles,
  type ProgressBarProps,
} from './components/progress-bar.tsx'
export { Spinner, type SpinnerProps } from './components/spinner.tsx'
export {
  textLinkClassName,
  textLinkStyles,
  type TextLinkClassOptions,
  type TextLinkVariants,
} from './components/text-link.tsx'
export {
  Tab,
  TabList,
  TabPanel,
  Tabs,
  type TabListProps,
  type TabPanelProps,
  type TabProps,
  type TabsProps,
} from './components/tabs.tsx'
export {
  toast,
  type ShowToastOptions,
  type ToastAction,
  type ToastId,
  type ToastPromiseMessage,
  type ToastPromiseMessages,
  type ToastPromiseOptions,
  type ToastPromiseOutcome,
} from './components/toast.ts'
export {
  Toaster,
  toasterStyles,
  type ToasterPosition,
  type ToasterProps,
  type ToastTone,
} from './components/toaster.tsx'
export {
  Tooltip,
  TooltipProvider,
  type TooltipProps,
  type TooltipProviderProps,
} from './components/tooltip.tsx'
export {
  Tree,
  type TreeNode,
  type TreeNodeAction,
  type TreeProps,
  type TreeSection,
} from './components/tree.tsx'

export {
  applyThemePreference,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeStorage,
} from './theme/theme.ts'
/*
 * The tenant's identity (ADR-028, layer 1) is **not** re-exported here. It is
 * `@quill/ui/theme`, because only a preview surface — the design showcase, and
 * later the theme editor — ever changes an identity, and re-exporting it from
 * the barrel put every built-in theme document, the theme schema's validator,
 * and the colour doctor into the bundle of every reader who opens a document
 * (review 2026-09-13, H1). `ThemeVariantsProvider` below is the runtime seam
 * that remains.
 */
export {
  ThemeVariantsProvider,
  useThemeVariants,
  type ThemeVariantsProviderProps,
} from './theme/theme-variants.tsx'
