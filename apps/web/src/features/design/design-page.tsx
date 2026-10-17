import {
  Block,
  Button,
  CommentsPanel,
  DocumentShell,
  RevisionTimeline,
  ThemeVariantsProvider,
  Tooltip,
  TooltipProvider,
  Tree,
} from '@quill/ui'
import { themeIdName, themeIdVariants } from '@quill/ui/theme'

import { BRAND } from '@quill/brand'

import { ThemeIdSwitcher } from '../theme/theme-id-switcher.tsx'
import { ThemeToggle } from '../theme/theme-toggle.tsx'
import { useThemeId } from '../theme/use-theme-id.ts'
import { useThemePreference } from '../theme/use-theme-preference.ts'
import {
  BadgeSpecimens,
  ButtonSpecimens,
  CalloutSpecimens,
  CommandPaletteSpecimen,
  InputSpecimens,
  NavigationSpecimens,
} from './component-specimens.tsx'
import { ContrastTable } from './contrast-table.tsx'
import { SampleDocument } from './sample-document.tsx'
import { SignatureSpecimens } from './signature-specimens.tsx'
import { AnimationSpecimens } from './animation-specimens.tsx'
import { DetailsSpecimens } from './details-specimens.tsx'
import { NavigationBlockSpecimens } from './navigation-specimens.tsx'
import { PropertySpecimens } from './property-specimens.tsx'
import { TableSpecimens } from './table-specimens.tsx'
import { COMMENTS, RAIL_ITEMS, REVISIONS, STATUS, TREE_SECTIONS } from './showcase-data.tsx'
import { Section, specimenAction } from './specimen-layout.tsx'
import {
  ColourSpecimens,
  DataTableSpecimen,
  LayoutSpecimen,
  RulesSpecimen,
  ShapeSpecimens,
  TypeSpecimens,
} from './token-specimens.tsx'
import { Avatar, WorkspaceMark } from './workspace-mark.tsx'

/**
 * The design system showcase.
 *
 * It is the shell it is showing: the rail, the tree, the status readout, the
 * revision timeline, and the comments panel around this page are the real
 * components carrying real props, not a picture of them. Inside, every
 * primitive appears in every state it can be in, and every signature variant
 * appears in both of its forms, so a regression in spacing, alignment, or
 * colour is visible here before it is visible in a feature.
 *
 * The two theme controls in the header are the two layers a person may change
 * (ADR-028): the identity is the tenant's, the scheme is the reader's.
 */
export function DesignPage() {
  const { preference, setPreference } = useThemePreference()
  const { themeId, setThemeId } = useThemeId()
  const variants = themeIdVariants(themeId)

  return (
    <ThemeVariantsProvider themeId={themeId}>
      <TooltipProvider>
        <DocumentShell
          status={STATUS}
          railItems={RAIL_ITEMS}
          railCurrentId="documents"
          railFooter={<Avatar />}
          mark={<WorkspaceMark />}
          navigation={
            <Tree label="Showcase documents" sections={TREE_SECTIONS} currentId="foundations" />
          }
          actions={
            <>
              <ThemeIdSwitcher
                themeId={themeId}
                onThemeIdChange={setThemeId}
                className="hidden sm:flex"
              />
              <ThemeToggle preference={preference} onPreferenceChange={setPreference} />
              <Tooltip content="Every publish creates a revision readers can see">
                <Button
                  size="sm"
                  onClick={specimenAction(
                    'This shows the button; publishing happens from the editor.',
                  )}
                >
                  Publish
                </Button>
              </Tooltip>
            </>
          }
          aside={
            <div className="flex flex-col gap-7">
              <RevisionTimeline revisions={REVISIONS} currentId="v12" />
              <CommentsPanel comments={COMMENTS} />
            </div>
          }
        >
          <div className="layout-grid pb-24">
            <Block width="wide" className="pt-12">
              <p className="meta text-accent">{themeIdName(themeId)}</p>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
                The design system
              </h1>
              <p className="mt-3 max-w-(--layout-content) text-base leading-relaxed text-muted">
                {BRAND.tagline} Generated palettes, the curated type set, the named-line reading
                grid, and the accessible primitives everything else is built from.
              </p>
              <p className="mt-5 max-w-(--layout-content) text-xs leading-relaxed text-muted">
                Switch identity or scheme in the bar above. An identity is a different type pairing,
                a palette generated from different seeds, and a different set of signature variants;
                a scheme is the same identity re-derived for dark. Both are one attribute on the
                document element and a repaint.
              </p>
              <div className="mt-5 sm:hidden">
                <ThemeIdSwitcher themeId={themeId} onThemeIdChange={setThemeId} />
              </div>
            </Block>

            <Section
              id="foundations"
              overline="Foundations"
              title="Type"
              description="One modular scale, never a theme's to change, set in the four faces the identity has chosen from the curated self-hosted set."
            >
              <TypeSpecimens />
            </Section>

            <Section
              id="colour"
              overline="Colour"
              title="Generated, never written"
              description="Every colour on this page was generated in OKLCH from two seeds — a neutral tone and one accent hue — at the lightness bands and chroma budget of the colour rules. Dark is a re-derivation, not an inversion. No stylesheet in this repository contains a hand-picked colour."
            >
              <ColourSpecimens />
              <ShapeSpecimens />
            </Section>

            <Section
              id="contrast"
              overline="Contrast"
              title="Held to the floors before it reaches CSS"
              description="The generator holds every pair to the WCAG 2.2 floors before a theme reaches CSS, in both schemes. These numbers come from that same generator, so they cannot go stale — switch identity and every row is recomputed."
            >
              <ContrastTable themeId={themeId} />
            </Section>

            <Section
              id="controls"
              overline="Controls"
              title="Buttons, fields, and status"
              description="Compact rows at the artboard's proportions. The accent appears on exactly one control in a view — the primary action — which is what keeps it meaningful when it does."
            >
              <ButtonSpecimens />
              <InputSpecimens />
              <BadgeSpecimens />
            </Section>

            <Section
              id="messaging"
              overline="Messaging"
              title="Callouts"
              description="An aside that changes the weight of a passage without changing its meaning. A rule down the leading edge rather than a tinted box, so it stays part of the document; the tone is in the words as well as the colour."
            >
              <CalloutSpecimens />
            </Section>

            <Section
              id="signature"
              overline="Signature"
              title="The variants a theme chooses between"
              description="A bounded set, each a real component with tests (ADR-028). The identity in scope decides which one a feature gets; every component still takes an explicit variant so a preview like this one can show both."
            >
              <SignatureSpecimens variants={variants} themeId={themeId} />
              <RulesSpecimen chosen={variants.rules} />
              <DataTableSpecimen />
            </Section>

            <Section
              id="navigation"
              overline="Navigation"
              title="Trails, tabs, tips, and dialogs"
              description="Everything here is reachable and dismissible from the keyboard alone. Tab into the tab list and use the arrow keys; open the dialog and try to tab out of it."
            >
              <NavigationSpecimens />
              <CommandPaletteSpecimen />
            </Section>

            <Section
              id="layout"
              overline="Layout"
              title="Three widths, one grid"
              description="ADR-027: every block spans the content, wide, or full lines of a single named-line grid. Below the medium breakpoint all three collapse to one column, so nothing is ever clipped."
            >
              <p className="text-xs leading-relaxed text-muted">
                The sidebars are columns of the shell, outside this grid, which is why a full-width
                block can never collide with the tree on the left.
              </p>
            </Section>

            <LayoutSpecimen />

            <Section
              id="reading"
              overline="Reading"
              title="The document surface"
              description="Body text at the reading measure in the identity's reading face, a table at wide, and a diagram at full. None of the elements below carry a class: the typography is applied by element, exactly as it will be when this HTML comes out of the Markdown pipeline."
            >
              <p className="text-xs leading-relaxed text-muted">
                The sample below is a real document, not a specimen sheet.
              </p>
            </Section>

            <Block width="full" className="mt-8">
              <div className="rounded-xl border border-border bg-surface-raised px-2 py-12 sm:px-6">
                <SampleDocument />
              </div>
            </Block>

            <Section
              id="tables"
              overline="Tables"
              title="Tables as good as a spreadsheet"
              description="ADR-040: every table feature, as Markdown and as the renderer draws it, with the reader's own tools. Scroll the page past a long table and its header hangs under the bar; press a header to sort; open any table full screen."
            >
              <p className="text-xs leading-relaxed text-muted">
                Each specimen's Markdown is under it. Switch the alignment to see the widths
                centred.
              </p>
            </Section>

            <Block width="full" className="mt-8">
              <TableSpecimens />
            </Block>

            <Section
              id="details"
              overline="Details"
              title="Details and accordions"
              description={`ADR-048: the browser's own details, in ${BRAND.name}'s directive, GitHub's HTML and Obsidian's foldable callouts, drawn by the theme's rules. Open one in an accordion and the others close; a link or find into a closed one opens it.`}
            >
              <p className="text-xs leading-relaxed text-muted">
                Each specimen's Markdown is under it.
              </p>
            </Section>

            <Block width="wide" className="mt-8">
              <DetailsSpecimens />
            </Block>

            <Section
              id="animated-emoji"
              overline="Animation"
              title="Animated emoji"
              description="ADR-047: an animated emoji plays when it comes into view, for at most five seconds or three loops, then rests on its still. Hover, focus or tap it to play it again. Readers who ask for less motion see only the still, with no script, and each person can choose play briefly, on hover only, or never."
            >
              <p className="text-xs leading-relaxed text-muted">
                The specimen's Markdown is under it.
              </p>
            </Section>

            <Block width="wide" className="mt-8">
              <AnimationSpecimens />
            </Block>

            <Section
              id="navigation-blocks"
              overline="Navigation blocks"
              title="Contents and child pages"
              description="ADR-056: a table of contents drawn from the page's own headings, and the pages under this one, filled for each reader as the page is assembled. Scroll the page and the section being read is marked in every contents."
            >
              <p className="text-xs leading-relaxed text-muted">
                Each specimen's Markdown is under it.
              </p>
            </Section>

            <Block width="wide" className="mt-8">
              <NavigationBlockSpecimens />
            </Block>

            <Section
              id="properties"
              overline="Properties"
              title="Document properties"
              description="What a document says about itself: who owns it, its status, when it was last reviewed, and its tags. A reader sees a quiet byline; an author edits each value in place (docs/design/properties.md)."
            >
              <PropertySpecimens />
            </Section>
          </div>
        </DocumentShell>
      </TooltipProvider>
    </ThemeVariantsProvider>
  )
}
