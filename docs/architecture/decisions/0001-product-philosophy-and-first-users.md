# ADR-001: Product philosophy and first users

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md Part I; decisions D1, D15

## Context

Quill enters a crowded space (Confluence, Notion, GitBook, Outline, Docusaurus, Backstage TechDocs). A platform that tries to serve every audience from the first release will be shallow everywhere. The project needs a stated audience so that scope and order decisions have a reference point.

## Decision

- Quill is an open-source, self-hostable documentation platform whose north star is: does this make it easier to create, maintain, understand, find, or trust documentation?
- The first users are software development teams inside a single organisation that may contain several companies, departments, and teams.
- Markdown is the durable representation. Versioning is free and invisible. Interactivity, provenance, and integrations are enhancements over a document model, never replacements for it.
- Quill will not become a project management tool, chat application, spreadsheet, database builder, whiteboard, workflow engine, low-code platform, or an AI-first product.

## Alternatives considered

- **Any team in any organisation as the first audience.** Rejected: it makes Git sync, source references, and public publishing hard to prioritise, and dilutes the editor and rendering work across use cases with conflicting needs.
- **Public docs sites as the primary product (Docusaurus/GitBook shape).** Rejected as the primary shape, but public publishing is in the first release because developer teams need it.

## Consequences

- Git sync, source references, code rendering, and public publishing are first-wave features rather than later phases.
- Industry-specific templates and workflows are deferred until the document model is proven.
- Every scope discussion can ask "does a software development team need this in release 1?"
