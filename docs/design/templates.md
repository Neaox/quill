# Templates: telling a template from a document

A template and a document made from it are the same Markdown. They are edited in the same editor, and they can look nearly identical on the page. Changing a document changes one page. Changing a shared template changes every document made from it from then on. The writing surface has to make that difference impossible to miss, without making either feel like a different product.

The decisions are in [ADR-054](../architecture/decisions/0054-template-library-and-authoring.md). These are the design rules that follow from them.

## Five cues, any one of which is enough

Template mode is carried by five cues. Each works on its own, so a person who misses one (a colour they cannot see, a band scrolled past, an address they never read) still meets the others. **Colour is never the only one.**

1. **The address and the breadcrumb.** Templates live at `/w/<workspace>/templates/…`. The breadcrumb's second step is **Templates**. A document is never reached through these addresses, and a template is never reached through a document's.
2. **The template band.** A strip directly above the writing surface. It contains:
   - a template icon and the word **Template**;
   - the template's name;
   - one line of state: "Editing v4 draft · v3 in use · Shared with Platform · Used by 41 documents";
   - **Try it** and **Publish v4**.

   It cannot be dismissed, does not scroll away with the page (it sits with the sticky chrome), and is labelled as a region so a screen reader announces it on arrival. It is an inline status in the sense of [`feedback.md`](feedback.md), not a toast or a dialog.
3. **The page.** The writing surface takes the `--template-*` tokens: a dashed page edge and a faint tint, light and dark. The tokens are applied by `data-kind="template"` on the editor root (AGENTS rule 15). They are checked with the doctor like every token, and the tint stays below anything that would compete with the accent.
4. **The fields and the panel.**
   - The title field is labelled **Template name**.
   - Below it, **Title for new documents** holds the title pattern, with answer tokens and `sequence` drawn as tokens.
   - The side panel is **Template setup**: questions, sections, stamped metadata, sequence, used for (collection defaults and audience).
   - A document's editor has none of these. It has the properties panel and, when made from a template, the template panel.
5. **The blocks.** Template machinery is drawn as machinery:

   | Block | In a template | In a document |
   | --- | --- | --- |
   | Placeholder | A chip with a dashed edge in the template tint, an I-beam icon, and the prompt text, which is what you are editing | Muted italic prompt text that typing replaces |
   | Answer token | A rounded token in mono naming the question (`answers.decisionOwner`), labelled by the question's label for a screen reader | The answer, as ordinary text |
   | Only when | A dashed frame labelled "Only when *Touches security* = Yes", with the condition editable from the label | Not present |
   | Repeats | A dashed frame labelled "Repeats · writers can add another" | An "Add another …" control after the last instance |
   | Optional | A dashed frame labelled "Optional · offered as Add section" | An "Optional · Add section: …" control |
   | Guidance | Editable text in a frame labelled "Guidance · shown to writers, removed at publish" | A hint card with a close button |

   The slash menu's **Template** group (Placeholder, Guidance, Optional, Repeat, Only when, Answer) appears only in a template.

## Wording

| Thing | Say | Not |
| --- | --- | --- |
| Releasing a template's draft | Publish v4 | Save, Update, Release |
| Who can see it | Share… / Only me / Everyone in Platform | Publish to workspace, Make public |
| Taking it out of the gallery | Retire | Delete, Archive |
| Making one from a document | Save as template | Templatize, Convert |
| A document's link back | From template: ADR v4 | Based on, Linked to |
| Going to change it | Edit template | Open template |

"Publish" always means "release a new version" and "Share" always means "who can see it". The two never share a button.

## On a document made from a template

The document looks like a document. The bar's readout adds "From template: ADR v4" beside the save state; it gives way before the save state does as the bar narrows (`chrome.md`). The template panel, beside the editor, carries:

- the required sections as a checklist ("1 of 3 required started"), each a link to its heading;
- the optional sections still on offer;
- the answers, each with **Change**;
- an offer of sections the template has gained since, when there are any;
- the line "Guidance and placeholders are removed when you publish";
- **Edit template** for someone who may change it, which leaves the document for the template's own address.

A required section's heading carries a small accent dot with the tooltip and accessible name "Required by this template". A section added by an answer carries an "Added by your answer" pill until the writer types in it.

## Publishing

- **A template's publish confirmation states its effect** and is a dialog, because it changes what other people get: "New documents will start from v4. The 41 documents made from v1 to v3 will not change. Their authors will be offered *Rollback plan*, which v4 adds."
- **Validation failures** are listed in the same dialog, each with a link to the frame or question at fault, and the publish button is disabled with the reason.
- **A document's publish with unfinished required sections** is an inline warning above the publish action, not a dialog: "2 required sections are still placeholders: Decision, Security considerations." It has a link to each, and **Publish anyway** beside **Keep writing**.

## The gallery

Two steps in one dialog:

1. **Pick.** Search across names and categories, then:
   - Blank;
   - Recently used;
   - the collection's default;
   - the workspace's templates;
   - the unit's templates;
   - built-ins.

   Each card shows the name, its source and version ("Platform workspace template · v4"), and a preview of its sections on focus.
2. **Answer.**
   - The questions are on the left. The right side shows **You'll get**: the numbered title, the sections the answers produce with "required", "added by your answer", "optional" and "add as many as you need" beside each, and the stamped metadata. Follow-up questions appear when the answer that needs them is given.
   - **Create and start writing** opens the editor at the first placeholder.
   - **Skip questions** is always offered: optional answers wait in the template panel.

## Screens to check

For each, check light and dark at 320, 768, 1280 and 1920 pixels:
- the template editor with every block type;
- Try it;
- the gallery's two steps;
- a document made from a template with the template panel open;
- both publish confirmations.

The band must not wrap its buttons below its label at 320. On a narrow screen the state line moves under the name.
