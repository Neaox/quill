# Changelog

Source: written for this spike, in the Keep a Changelog format (keepachangelog.com).

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.

## [Unreleased]

### Added

- Block layout widths (`:::wide`, `:::full`) — see [ADR-027].
- `GET /api/documents/:id?format=ast`.

### Changed

- Drafts now store the AST rather than Markdown ([ADR-021]).

### Fixed

- Nested task lists lost their `checked` state on publish.

## [0.3.0] - 2026-08-14

### Added

- Comments anchored to text selections.
- Share links with an expiry.

### Deprecated

- `POST /api/pages` — use `POST /api/documents`.

### Removed

- The `legacy_html` export target.

### Security

- Share-link tokens are now 256 bits.

## [0.2.0] - 2026-06-02

### Added

- Git sync, two-way.

[unreleased]: https://github.com/example/quill/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/example/quill/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/example/quill/releases/tag/v0.2.0
[adr-027]: ./docs/architecture/decisions/0027-block-layout-widths.md
[adr-021]: ./docs/architecture/decisions/0021-drafts.md
