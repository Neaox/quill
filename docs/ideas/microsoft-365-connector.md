# Microsoft 365 connector: Excel ranges as live tables

- **Status:** proposed
- **Recorded:** 2026-10-11
- **Trigger:** live blocks and connectors land (ADR-032, M5; [connectors idea](work-tracker-and-code-host-connectors.md)), or an organisation keeps figures in Excel that its documents quote

## Idea

Connect an organisation's Microsoft 365 tenant once, and a document can show a range, a named range or an Excel table from a workbook in OneDrive or SharePoint as a Quill table, with every formula evaluated, kept current, and rendered with all of Quill's table features.

```markdown
::excel{workbook="https://contoso.sharepoint.com/:x:/r/…/Budgets.xlsx" table=Q3Forecast}
::excel{workbook="…" sheet=Summary range=A1:F20 headers=both footer=1}
```

## Who it serves

Teams whose numbers live in spreadsheets: budgets, capacity plans, SLAs, price lists. Today they paste values that go stale, or screenshots nobody can read on a phone. They get a real, accessible, sortable table that matches the workbook.

## What it touches

- **Connectors** (plan §19, ADR-008, the connectors idea). This adds a Microsoft 365 provider that authenticates with Entra ID: an app registration with admin consent and an organisation-scoped token, never the reader's.
- **Live blocks (ADR-032).** The fetcher reads values through Microsoft Graph's workbook API.
  - Excel evaluates the formulas; Quill never evaluates them itself.
  - The fetcher takes the displayed (formatted) values, plus number formats, so currency and percentages read as in Excel.
  - The result is snapshotted with an "as of" time and refreshed on a cadence or by a change notification.
- **Tables (ADR-040).**
  - The snapshot renders through the same table renderer: caption from the table name, header row and column, totals row as the footer, numeric alignment, sorting, frozen header, the full-screen viewer, and copy as CSV or Markdown.
  - Merged cells, which Markdown cannot express, are flattened, and the block says so.
  - Cell colours are not carried over: no information may depend on colour alone.
- **Markdown extensions (ADR-039).** A packaged extension with a `live` binding. Outside Quill the directive reads as a link to the workbook. "Freeze as Markdown" writes the current values into the document as an ordinary GFM table, for a frozen copy.
- **Link previews (ADR-042).** A pasted Excel or SharePoint link offers "Show as table", with a picker for sheet, range or table via the connector.

## Open questions

- **Permissions:** the snapshot shows what the connector's account can read, to everyone who can read the page. Should a block be limited to workbooks in sites the workspace is granted?
- **Size:** what limit on rows and columns is sensible inline (with the viewer and paging beyond it)?
- **Charts:** should Excel charts become Quill charts or images?
- **Other Microsoft content:** Word documents as cards, Teams channels as deep links (ADR-044), SharePoint lists as tables. Same connector, later.
- **Google Workspace:** Google Sheets via its API is the natural sibling.
