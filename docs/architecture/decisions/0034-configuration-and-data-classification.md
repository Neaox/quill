# ADR-034: Configuration and data classification

**Status:** Accepted
**Date:** 2026-09-12
**Related:** quill-plan.md sections 9, 11, 25; ADR-011, ADR-014, ADR-022, ADR-024, ADR-028, ADR-033

## Context

Where a setting lives decides who can change it, whether it travels with the files, and what a restore needs. The same question applies to data: which tables are the system of record and which are indexes that can be rebuilt from the content store.

## Decision

### Configuration lives in three places, by nature

| Kind | Where | Examples | Why |
|---|---|---|---|
| **How the process runs** | Environment (`.env` locally, the platform's secret store in production), documented in `.env.example` | `DATABASE_URL`, content and blob store locations, `APP_URL`, SMTP, the instance encryption key, log level, port | Twelve-factor: the same image runs anywhere; secrets never enter the database or the repository |
| **What the organisation configured** | Postgres, edited through the application by administrators | SSO providers and their (encrypted) client secrets, share-link policy, organisation theme, unit and group structure, membership, the "require SSO for this domain" rule | Changes at runtime, per organisation, by people who never see a server; encrypted with the instance key from the environment |
| **What belongs to the documents** | The content store, as files beside the documents (`.quill/workspace.yaml`, template documents) | Workspace publish settings, navigation overrides, schema versions, template declarations, per-workspace theme overrides | Travels with the files, is versioned with them, and survives a move to another instance or to plain Git |

The rule for a new setting: if an operator sets it, it is environment; if an administrator sets it in the product, it is database; if it describes the documents and should follow them, it is a file in the content store.

### Organisation settings are files the application maintains

Most of what an administrator configures in the product has no need for a database row: themes, share-link policy defaults, navigation and publish settings, template registration, the units and workspaces structure. These are written by the application as **versioned files in the content store**, in a system workspace (`settings/instance.yaml`, `themes/<id>.theme.yaml`, the workspaces' own `.quill/workspace.yaml`), through the same publish path documents use. The administrator edits them in the product and never sees a file; the file exists so that:

- every change is a revision with an author and a change note, for free, so settings have history and restore like documents;
- an instance moves to another host, or a theme moves to another instance, by copying files;
- concurrent servers write safely through the content store's compare-and-swap, which a mutable `settings.json` on disk could not offer;
- `reindex` rebuilds the settings tables from the files, so they are indexes, not systems of record.

Postgres keeps only what must be transactional, private, or per person: users, credentials, sessions, grants, membership, comments, drafts, share links, audit. Membership and grants stay in the database because they are permission data that must never leak through a file copy.

### Secrets

Secrets are never written to a settings file or committed to the content store. There are two kinds.

- **Operator secrets** (database URL, SMTP credentials when the operator provides them, the instance master key or a reference to it) live in the environment or the platform's secret store, per the table above.
- **Secrets entered in the product** (OIDC client secrets, integration tokens, webhook signing keys, SAML signing keys the application generates, SMTP credentials when an administrator provides them) are stored in Postgres under **envelope encryption**: each secret is encrypted with its own data key using AES-256-GCM, and the data key is wrapped by a master key the application never stores. The master key comes through a `KeyProvider` port with implementations for a key in the environment (the self-host default), a key file on a mounted volume, and cloud key services (AWS KMS, Google Cloud KMS, Azure Key Vault, HashiCorp Vault) so a cloud deployment never has a raw key in an environment variable. Rows carry the key id and version, so rotation re-wraps data keys without touching ciphertext, and a secret is decrypted only at the moment of use, never logged, never returned by any API.
- **Settings files reference secrets by name, never by value**: `clientSecret: { ref: 'oidc/entra/client-secret' }`. A copied settings file is therefore complete and harmless, and the target instance asks for the secrets it does not have.

A restore on a new host needs the content store, the blob store, the database dump, and the master key or key-service access; without the master key every document and setting survives and only the entered secrets must be re-entered.

### Data is classified as system of record or index

**Systems of record**, backed up as such (ADR-024):

- The content store: every document, its front matter, its full revision history, workspace file settings, and small images committed beside documents.
- The blob store: attachments and source artifacts.
- Postgres, for what has no file form by design: users, credentials, passkeys, sessions, federated identities, units, groups, membership, grants, share links, comments and their anchors (ADR-022 keeps them out of Markdown), drafts and locks, notes for later, audit events, organisation settings and themes, live-block snapshots' provenance.

**Indexes**, rebuildable from the systems of record by one command (`quill reindex`, per workspace or whole instance), never backed up as authoritative:

- The documents table's content-derived columns (title, path, status, template reference), rebuilt from front matter and the tree.
- The revisions index, rebuilt from commit trailers (measured in R4 at about 3,100 commits per second).
- The render cache, the document links table, the search index, the effective-permission table (ADR-012), template registry entries, and the outline and text extracts.

Every index table carries the content hash or revision it was derived from, so `reindex` can be incremental and a partial rebuild is always safe.

### What a restore needs, stated plainly

- Content store plus blob store plus a Postgres dump: everything, from the moment of the dump.
- Content store plus blob store only: every document, every revision, every attachment, the workspace structure and its file settings, and every index rebuilt; **lost**: accounts, permissions, comments, unpublished drafts, share links, audit history, organisation settings. This is the "we still have our documentation" floor, and it is why nothing that a reader needs to understand a document is ever only in Postgres.

## Alternatives considered

- **Everything in the database.** Rejected: settings that describe documents would not travel with them, and the floor above would not exist.
- **Everything in files.** Rejected: credentials, sessions, grants, and comments need transactions, revocation, and privacy that files do not give, and comments in Markdown break the portability rule (ADR-022).

## Consequences

- `reindex` is a first-class command built with the read path in M2 and exercised in tests after every publish path change.
- `.env.example` is the complete list of process configuration, and the operations guide names which environment variables are secrets.
- The workspace file settings (`.quill/workspace.yaml`) get a versioned schema like every other persisted format (ADR-033).
