# Search

How searching looks and behaves: the palette, the results page, and what they share. The query language and the engine are ADR-010 (and its amendments); this is the experience on top of them.

Two surfaces, one vocabulary:

- **The palette** (Ctrl or Cmd + K) answers "which document did I mean?" in eight rows, plus places to go.
- **The results page** (`/w/<workspace>/search?q=`) answers "show me everything". The query is in the address, so a search can be linked to and shared.

Both read the same text with the same parser (`@quill/search/query`), so a chip, a suggestion and the answer on screen cannot disagree about what was asked.

## Anatomy of a hit

```
Regional failover                                  title: the option's or link's name
Follow the **failover** runbook, then verify ...   snippet, matched words marked
Engineering / Runbooks                             where it lives
[DRAFT] by Ada Lovelace, Sam Taylor +2   Updated 2 hours ago
[INCIDENT] [POSTMORTEM] [DR]                       page only
```

- **Title** is the whole of the accessible name. Everything else is the description, so a screen reader announces "Regional failover" on arrival and reads the rest after it. The palette (`role="option"`) and the page (a real link) wire this up the same way.
- **Status** is a quiet badge, shown only when the document is not published. Published is the ordinary case and says nothing. The word carries the meaning; the tone is only emphasis.
- **Contributors** are names only, most recent first, at most three, then "+N" for the rest. The phrase is left out when there is nobody to credit. The server never sends an address.
- **Updated** is a relative time (`<time>`), with the exact moment on hover and in `datetime`.
- **Tags** (page only, at most three) are quiet badges after a visually hidden "Tags:".

Two densities, one component (`SearchHitDetail`): `compact` in the palette (one line of facts that truncates, no tags) and `comfortable` on the page (facts wrap, tags shown). Titles truncate on one line; nothing forces a horizontal scroll at 320px.

## Filters you can see

The filters in the **applied** query (the address, not what is being typed) are shown as chips under the field, in a list labelled "Filters": "By: me", "Not tag: old". A chip's remove button is named "Remove filter By: me". Removing one searches again without it and returns focus to the field. With no filters there is no list at all, not an empty one.

In the palette the chips belong to the live query and sit between the field and the list. Radix's dialog keeps focus inside the panel, so the palette hands the chip row a way back into the field (`renderFilters`' `focusField`).

A custom property reads as "Property: severity=high" (`prop:severity=high`); it is typed, never suggested, so it is not in the "Add a filter" row.

Words, phrases and exclusions stay in the field; only filters become chips. A query the parser cannot read has no chips; the field's own notice says what is wrong with it.

## Refine

Filters you can see are what the query already says; **Refine** is what it could say next. Under the chips and the "Add a filter" row, the results page offers the commonest tags, statuses and collections among the results, each with how many it would leave, so a person can narrow a broad search without knowing the syntax or the vocabulary.

```
REFINE
Tag          [+ api 12] [+ incident 7] [+ area/billing 3]
Status       [+ Draft 4]
Collection   [+ Runbooks 9] [+ Release notes 2]
```

**Anatomy.** A `<section>` labelled by an `h2`, "Refine" (the same level as the result groups, so the outline reads Search, Refine, then the results). One group per facet that has something left, always in the order Tag, Status, Collection; each group is a small label ("Tag") over a wrapping list of pill buttons. A pill is a plus, the value and its count, outlined and unfilled, so it cannot be mistaken for a chip (a filled shape with a remove button): chips are applied, pills are suggestions. The plus and the position carry that difference, not colour. A long value truncates on one line; the row wraps at 320px and never scrolls sideways.

**Behaviour.**

- Choosing a pill searches again with that filter added after everything already in the query (`tag:api`, `status:draft`, `collection:"Release notes"`). Words, phrases and exclusions stay exactly as they were, and the value is quoted by the query serializer, never by hand. The value written is the server's `value`, not the label shown.
- Counts are over the whole match set the reader may read, not the page of results, and reflect the query as asked. They are asked for on the first page only; "Show more" neither asks again nor loses them.
- Hidden: a value the query already filters on (same filter and value, ignoring case; also one it rules out with a minus, because adding it would contradict the query), and for tags the exact parent when it is already filtered on (`tag:area` hides `area`, but `area/billing` is still offered because it is narrower). A group with nothing left disappears.
- Tags are hierarchical: `area` and `area/billing` can both appear, with the parent counting everything beneath it.
- After a choice, focus moves to the search field, as it does after removing a chip. The pill that was pressed is no longer offered (what it chose is hidden), so focus on it would be lost to the page; the field is the one stable place to land after any change to the query, and the place to keep typing.
- The palette does not show Refine: it has no room, and it is for finding one document.

**States.**

| State | What is shown |
| --- | --- |
| First answer on its way | Nothing; "Searching…" below. |
| A refined answer on its way | The previous facets stay, so the row does not blink out and back on every choice; the page is `aria-busy`. |
| Nothing left to offer, no facets returned, nothing matched | Nothing at all: no heading over an empty region. |
| Empty, too long, refused or failed query | Nothing: the counts would describe a different search. |

**Accessibility.** Each pill is a `button` named for its value and count together ("api, 12 results", "area/billing, 1 result"; counts formatted for the reader's locale), so a screen reader hears what it will leave. The groups are lists named by their label. Pills are 24px tall at least and 44px on a coarse pointer, have a visible focus ring and a hover state, and are ordinary tab stops in reading order. Component tests run axe over the section and the page with it showing.

**Deliberately not there.** A facet for people (it would count every contributor by name, which is a directory by another route, and `by:` and `team:` already have typeahead); a per-facet "more" (eight values each is the server's cap, and a long tail is what typing a filter is for); counts broken down by workspace (the groups below already say where results are); and facets in the palette.

## Typeahead

Suggestions are for the **token the caret is in**:

| Caret is in | Offered |
| --- | --- |
| a word that begins a filter's name (`te`) | **Filters**: each with its name and what it finds. Choosing one writes `team:`, keeps the list open, and the next thing offered is its values. |
| a filter with suggestions (`by:ad`) | The values, from `GET /api/search/suggestions`, as one group labelled with the filter ("By"), after a 150 ms pause. The previous list stays while the next arrives. |
| anything else: an ordinary word, a quoted phrase, whitespace, a filter with no suggestions (`owner:`) | Nothing. The list never opens on every space. |

Choosing a value replaces the token with the filter and the value (quoted when it needs to be), keeps a leading minus, adds a space unless one follows, and puts the caret straight after it.

- **The results page** reads the caret on every change and on the document's `selectionchange`, so editing `by:ad` in the middle of a long query offers people, not what comes last.
- **The palette** does not expose its caret, so the token being typed is the last one. Its suggestions are the **first** group, ahead of commands and results, and choosing one edits the query without closing the palette.
- Nothing is suggested, and nothing fetched, until somebody has been in the box: a page that loads with `by:me` does not ask the server for names nobody opened.

**Enter belongs to the form until the arrows have reached an option** (page only). A search for the word "team" must not become the filter `team:` because a list happened to be open. ArrowDown then Enter, or a click, chooses. The palette keeps its own rule, where Enter opens the top result.

"Add a filter:" under the chips is a row of small buttons, one for each filter that has values (By, Team, Tag, Collection, Workspace, Status). Each appends `key:` after a space, focuses the field and opens its suggestions, so nobody has to know the syntax to begin. Each button's name is the filter and its description is what it finds (also the hover title). The row wraps on a narrow screen rather than disappearing.

## States

| State | What is said |
| --- | --- |
| Empty query | "Type to search every workspace you can read." |
| Waiting | "Searching…", in words as well as the spinner. The field reads `aria-busy`. |
| Suggestions pending | "Searching…" in the list; the previous values stay if there are some. |
| Nothing suggested | "Nothing suggested". |
| Suggestions fail | Nothing: the field still works. |
| No results | "Nothing matched “q”" and what to try; with filters in the query, "Try removing a filter, or use fewer words." |
| Invalid query | The refusal, with the character it happened at marked (`invalid-query-notice.tsx`). |
| Search fails | A danger callout; the page stays. |

Politely announced (`role="status"`): the settled number of results, and the settled number of suggestions ("3 suggestions", "No suggestions"). Nothing is announced while an answer is on the way.

## Keyboard

| Key | Does |
| --- | --- |
| Ctrl or Cmd + K | Opens the palette. |
| Down / Up | Moves through suggestions (and, in the palette, results). |
| Enter | Chooses the active option; on the page with none active, searches. |
| Escape | Closes the list; again, gives up (palette: closes). |
| Tab | Leaves the field; the list is never a tab stop. |
| Home / End | The caret's, as in any text box. |

Focus never leaves the field while a list is open (`aria-activedescendant`). Chips' remove buttons and the "Add a filter" buttons are ordinary tab stops, 24px at least and 44px on a coarse pointer.

## Accessibility

Combobox and listbox semantics throughout (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`). Groups are named by their label. No information is carried by colour alone: a negated chip says "Not", a status says its word. Component tests run axe over the field with its list open, the chips, the filter row and the hit in both densities.

## Deliberately not there yet

- Recent searches and saved searches.
- A filter builder dialog, or date filters (`updated:`).
- Suggestions for `owner:`, `title:` and `prop:` (they have none to offer).
- Highlighting inside the field itself (filters coloured as you type); the chips do that job after the search.
- Typeahead inside the palette at the caret rather than at the end of the query.
- Keyboard access to remove chips from within the field (Backspace into a chip); the buttons are tab stops.
