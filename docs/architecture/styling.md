# Styling: how state and variation are managed

Every component has two kinds of variation that are easy to confuse and must be handled differently. Getting this split right is what keeps a component's class list readable at forty states instead of four. A third layer, theme and identity, never enters a component at all.

## 1. Interaction and accessibility state: attributes plus Tailwind variants

Hover, focus, active, disabled, busy, invalid, checked, selected, open, expanded, pressed, current, read-only. These are facts about the element that assistive technology also needs, so they are expressed **once, as real attributes on the element**, and styling follows the attribute with Tailwind variants. No JavaScript branch ever decides a colour for a state.

| State | The attribute | The Tailwind variant |
|---|---|---|
| Disabled | `disabled` | `disabled:` |
| In flight | `aria-busy="true"` | `aria-busy:` |
| Invalid input | `aria-invalid="true"` | `aria-invalid:` |
| Selected, checked, pressed, expanded, current | `aria-selected`, `aria-checked`, `aria-pressed`, `aria-expanded`, `aria-current` | `aria-selected:` and so on, bare |
| Our own boolean state | a boolean data attribute such as `data-active`, `data-dragging`, `data-required` | `data-active:`, bare, matching presence |
| Enumerated state from headless primitives | `data-state="open"` | `data-[state=open]:`, bracketed only because a value is compared |
| Open details, dialog, popover | native `open` | `open:` |
| Keyboard focus | none needed | `focus-visible:` |
| Pointer hover | none needed | `hover:` |
| Negation | | `not-disabled:`, `not-aria-selected:`, `not-data-active:` |
| Parent-driven | the attribute on the parent, marked `group`, or any ancestor with `in-*` | `group-aria-expanded:`, `group-data-active:`, `in-data-dragging:` |
| Children | | `*:` for direct children, `**:` for all descendants |

Custom variants for our own axes are declared once in the design system with Tailwind 4's `@custom-variant`: `dark` (already), the theme id (`theme-instrument:`), density (`compact:`), and the theme's signature axes (`rules-hairline:`), all read from data attributes on the root or the document shell. A component that must look different under a theme variant uses the variant class; it never receives the theme as a prop.

## 2. Design variation: `tailwind-variants`

`variant="primary" | "secondary" | "ghost" | "danger"`, `size="sm" | "md" | "lg"`, `tone="info" | "warning"`. These are choices the author of the JSX makes, not facts about the element. They are declared with **tailwind-variants** (`tv`), whose variant API is the same as `cva`'s, the shape most readers already know, plus **slots** for multi-part components and a built-in `tailwind-merge`:

```ts
const button = tv({
  base: 'inline-flex items-center gap-2 rounded-md border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  variants: {
    variant: {
      primary: 'border-transparent bg-accent text-accent-foreground hover:bg-accent-hover',
      secondary: 'border-border-strong bg-surface-raised hover:bg-surface',
      ghost: 'border-transparent hover:bg-surface',
      danger: 'border-transparent bg-danger text-accent-foreground hover:bg-danger-hover',
    },
    size: { sm: 'h-8 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm', lg: 'h-11 px-5 text-base' },
  },
  compoundVariants: [{ variant: 'ghost', size: 'sm', class: 'px-2' }],
  defaultVariants: { variant: 'primary', size: 'md' },
})
export type ButtonVariants = VariantProps<typeof button>

const dialog = tv({
  slots: {
    overlay: 'fixed inset-0 bg-overlay data-[state=open]:animate-fade-in',
    panel: 'fixed top-1/2 left-1/2 w-full max-w-lg rounded-lg bg-surface-raised shadow-dialog data-[state=open]:animate-dialog-in',
    title: 'text-lg font-semibold',
    footer: 'flex justify-end gap-2',
  },
  variants: { size: { md: { panel: 'max-w-lg' }, lg: { panel: 'max-w-2xl' } } },
})
```

- The component's props type is `VariantProps<typeof button>`, so variants are typed once and cannot drift from the class definitions.
- Interaction states live in `base`, or in each slot, using the variants from section 1, so every design variant gets every state for free.
- **Slots** are how multi-part components are declared: one definition, one place to read, variants that reach into the parts they change.
- `tv` merges conflicting classes itself; `cx` in the design system is its `cn`, configured once through `twMergeConfig` for custom utilities such as `text-reading`. Passing `className` to override a variant remains discouraged; the supported way to change a look is a variant.
- `extend` composes one definition from another, an icon button from the button, without repeating classes.
- A component that forwards a `className` prop passes it straight to the variant or slot call — `styles.root({ className })`, not `cx(styles.root(), className)` — because `tv()` already merges `className` through `tailwind-merge`; `cx` earns its place only where two independent results have to be combined, such as merging two variant results (`cx(proseTableStyles(), scrollGroupStyles())`) or a literal class list with a prop (`cx('rounded-sm text-muted', className)`). `quill/prefer-variant-classname` enforces the first form and fixes the redundant-`cx` shape automatically.

## 3. Theme and identity: tokens and CSS, never per-component logic

Colour, type, radius, density, and the theme's signature variants (hairline versus double rules, readout versus breadcrumb header) are CSS custom properties and data attributes from `@quill/theme` (ADR-028). Components reference semantic utilities (`bg-surface`, `text-muted`, `rounded-md`) and react to theme axes through the custom variants in section 1. No component imports the theme package or branches on a theme id.

## 4. Tailwind 4 conventions

### Brackets are the exception

Tailwind 4 needs `[...]` only for a compared value (`data-[state=open]:`, `aria-[sort=ascending]:`) or a truly arbitrary value. Everything with a bare form uses it.

### Every size comes from the base

Spacing and size utilities derive from one `--spacing` value (0.25rem by default), so any multiple has a utility without configuration: `w-17`, `mt-13`, `gap-7.5`, `size-9`, `inset-2.5`. There is never a reason to write `w-[68px]`; write `w-17`. Density is therefore one variable: the compact density step sets `--spacing` on the shell, and every spacing utility beneath it scales together. Font sizes are the exception: they come from the type scale tokens (`text-sm`, `text-reading`) and never from a literal.

### Layout tokens by variable, not by literal

Widths that are design tokens (`--layout-content`, `--layout-wide`, `--layout-max`) are referenced with the variable shorthand, `max-w-(--layout-content)`, never `max-w-[42rem]`. A literal there silently drifts from the grid.

### Container queries before viewport breakpoints

Built in: mark a region with `@container` (named where it helps, `@container/main`) and style its children with `@sm:`, `@md:`, `@lg:`, or `@min-[…]`. A component then responds to the space it actually has, which is what matters when a navigation rail, a comments panel, presentation mode, or an embedded island changes the available width while the viewport does not. The reading grid (ADR-027) collapses its `content`, `wide`, and `full` lines by the width of `.page-main`, not the viewport; tables, the revision timeline, callouts, and the document header adapt to their container; viewport breakpoints (`sm:`, `md:`) are reserved for the page shell, which has no container above it.

### Canonical spellings

Tailwind 4 renamed part of its vocabulary. Some old spellings no longer exist, some now mean something else, and the size scales for shadows, radii, and blurs shifted one step, so `rounded-sm` is what `rounded` used to be. Because this repository defines its own radius and shadow scales in `@theme`, the sized names (`rounded-sm`, `shadow-sm`, `blur-sm`) are canonical here and mean exactly what the token says. `pnpm check:tailwind` fails the gate on the rows below, scanning class strings and `@apply` lines only.

| Write this | Not this |
|---|---|
| a sized name: `shadow-sm`, `rounded-sm`, `blur-sm`, `drop-shadow-sm`, `backdrop-blur-sm` | the bare `shadow`, `rounded`, `blur`, `drop-shadow`, `backdrop-blur`, which no longer exist |
| `outline-hidden` | `outline-none`, which now genuinely removes the outline; never on a focusable element |
| the width you mean, `ring-1` or `ring-3` | bare `ring`, still valid but now 1px |
| the modifier: `bg-black/50` | `bg-opacity-50` and the other `*-opacity-*` utilities |
| `shrink-0`, `grow` | `flex-shrink-0`, `flex-grow` |
| `text-ellipsis` | `overflow-ellipsis` |
| `box-decoration-slice`, `box-decoration-clone` | `decoration-slice`, `decoration-clone` |
| `bg-linear-to-r` | `bg-gradient-to-r` |
| `flex!` | `!flex` |
| `data-active:`, `aria-busy:` | `data-[active]:`, `aria-[busy=true]:` |
| `grid-cols-15`, `mt-17`, `w-29` | `grid-cols-[repeat(15,minmax(0,1fr))]`, `mt-[68px]`, `w-[116px]` |
| `max-w-(--layout-content)` | `max-w-[42rem]` |
| `min-h-dvh`, `h-svh` | `min-h-[100dvh]`, `h-[100svh]` |
| `*:`, `**:` | `[&>*]:`, `[&_*]:` |
| `@container`, `@sm:`, `@md:` | the container-queries plugin |
| `@import 'tailwindcss';` | `@tailwind base; @tailwind utilities;` |
| `var(--color-accent)` in CSS | `theme('colors.accent')` |
| `@utility x { … }` | `@layer utilities { .x { … } }` |
| `@theme`, `@custom-variant`, `@source` in CSS | `tailwind.config.js` |

Also used here: `size-*` for equal width and height, `not-*` for negation, `in-*` for ancestor state, `@theme inline` for tokens that must resolve at runtime, and stacked variants apply left to right.

## What is never done

- Conditional class strings assembled in JSX (`className={isOpen ? 'a' : 'b'}`) for states that have an attribute: put the attribute on the element and use the variant.
- `style` props for anything a token or a variant can express.
- Styles computed in JavaScript from state or theme.
- Restyling a primitive from a feature. If a feature needs a new look, the primitive gains a variant.

## Why this split

Attributes are the single source of truth for both assistive technology and styling, so a state cannot be visible to one and not the other. `tv` makes design variation declarative and typed, with slots for the multi-part components that are the common case here. Tokens and data attributes make theming a change of CSS, not of components. Container queries make components right in any region they land in. Each layer has one familiar tool, and a reader can tell which layer a class belongs to by where it sits.
