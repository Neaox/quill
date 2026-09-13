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
| **What belongs to the documents** | The content store, as files in the system workspace (`.quill/organisation.yaml`, `.quill/workspaces/<id>.yaml`) and beside the documents (template documents) | Workspace publish settings, navigation overrides, schema versions, template declarations, per-workspace theme overrides | Travels with the files, is versioned with them, and survives a move to another instance or to plain Git |

The rule for a new setting: if an operator sets it, it is environment; if an administrator sets it in the product, it is database; if it describes the documents and should follow them, it is a file in the content store.

### Organisation settings are files the application maintains

Most of what an administrator configures in the product has no need for a database row: themes, share-link policy defaults, navigation and publish settings, template registration, the units and workspaces structure. These are written by the application as **versioned files in the content store**, in a system workspace — `.quill/organisation.yaml` for the organisation and `.quill/workspaces/<workspace id>.yaml` for each workspace — through the same publish path documents use. The administrator edits them in the product and never sees a file; the file exists so that:

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
- The workspace file settings (`.quill/workspaces/<id>.yaml`) get a versioned schema like every other persisted format (ADR-033).

### Decided while building the settings store (13 September 2026)

The server side of this ADR is built. Six things it did not settle were settled here, and each is recorded because a later reader will otherwise assume the ADR said so.

- **The content store gained a path-addressed file API.** A settings file is not a document: it has no id in front matter, so `ContentStore.read`, which finds a document by scanning the Markdown blobs of a tree, cannot find one. `readFile(workspaceId, path, revision?)` and `putFile(request)` were added to the port beside `read` and `publish`. This is not a breach of `AGENTS.md` rule 8 — *a document* is its id, and these are not documents.
- **A settings write refuses rather than merges.** `publish` three-way merges a stale base, because two authors editing one document usually mean to keep both edits. That reasoning does not carry to a policy: blending two administrators' versions of a settings file produces a configuration neither of them chose. So `putFile` is a compare-and-swap on **the file's own bytes**, checked inside the same loop as the ref compare-and-swap, and a losing writer gets a conflict carrying what the file says now.
- **The compare-and-swap is over bytes, not revisions.** A revision belongs to the whole system workspace and moves whenever *any* settings file changes, so comparing revisions would make two administrators configuring two different workspaces collide for no reason. A write states the revision it read at, the adapter recovers the file's bytes at that revision, and those bytes are the expectation.
- **The system workspace has a fixed id and no row.** `00000000-0000-4000-8000-000000000000` is a workspace to the content store and to nothing else: no row in `workspaces`, so no picker lists it, no grant names it, and no document route reaches it. Fixed rather than generated because a restore from files alone has to find it.
- **The theme doctor does not refuse a save.** ADR-028 says the doctor advises and names AA text contrast as the one rule enforced by default. The enforcement is in the theme editor, in front of the administrator who can see the reason and the instance switch; `updateOrganisationSettings` returns the report — `enforcedRulesHold` included — and saves. Refusing at the API would put the decision somewhere nobody can see it.
- **Layout is a settings type, not yet a theme rename.** ADR-028's amendment says the theme document's `variants` block becomes `layout`. The bounded set is now declared in the settings documents (`Layout`), and the organisation's default is seeded from the theme's `variants`, read through one function (`recommendedLayout`). Renaming the block inside `packages/theme`, the token map and the web shell is the remaining half of that amendment and is deliberately separate.

- **Every workspace's settings live in the system workspace, not in the workspace itself.** The alternative — `.quill/settings.yaml` inside each workspace's own repository, travelling with its documents — was considered and rejected. A workspace's settings are not a property of its documents: they are what an *organisation* decided about that workspace, and the one setting in them today, the layout override, exists only because the organisation allows it and stops existing when the organisation locks it. Keeping them together also means one compare-and-swap domain, one place a restore looks, and an export (M4) that carries the organisation's configuration as one thing rather than reassembling it from every repository. The cost is that a workspace copied to another instance arrives without its layout, which is the right default anyway: the receiving organisation's theme and layout are the ones that should apply.
- **Both layers of the envelope are bound to where they sit.** The value is sealed with `secret:v1:<name>` as associated data and the wrapped data key with `wrap:v1:<key id>`. Without that, a row's bytes are interchangeable with any other row's under the same key, so somebody who can write the table — a SQL injection, a restored dump, a database administrator — but cannot read the master key can move the SMTP password into the OIDC client secret's row and have the application use it as one. GCM cannot tell those apart; the label can. The labels are versioned because they are authenticated data that stored rows carry: a change is a `v2` tried beside `v1`, never an edit.
- **"A real deployment" is the app URL's host, not `NODE_ENV`.** An instance whose `APP_URL` is not loopback refuses to boot without an explicit master key, whatever `NODE_ENV` says, and refuses the published all-zero development key by value. It is the same signal `loadSessionConfig` takes the cookie's `Secure` flag from (ADR-011), so an instance cannot be strict about its cookies and lax about the key that wraps every secret in it. The `NODE_ENV=production` refusal stays as well.
- **The master key rotation is a compare-and-swap per row.** `UPDATE ... WHERE name = $1 AND key_id = $2 AND wrapped_key = $3`: a rotation running beside an administrator replacing that very secret would otherwise write the old value's data key over the new value's, and the new value would never open again.

Four smaller ones:

- **A key id is an HMAC of a fixed label under the key**, not a digest of the key. A digest would make a published `key_id` — in a dump, a log line, an audit row — a verifier for offline guessing of the key itself. The label is derived from the brand slug, so a rename does not have to reach into stored rows.
- **The `KeyProvider` port is `wrap`/`unwrap`**, not "give me the key", because that is the shape a cloud key service offers; the environment and key-file providers implement it locally over AES-256-GCM.
- **A key file must not be readable by anyone but its owner**, and is refused rather than warned about when it is. Windows reports a mode that means nothing, so there it warns and names what it could not check.
- **Development gets the all-zero master key and a warning**, rather than a generated one. A generated key would lose every secret on restart, which reads as a bug; the all-zero key could never be mistaken for a real one.

Two the settings screens will meet first:

- **`policies.contrastEnforcement` is where ADR-028's "an instance administrator can switch that enforcement to advisory" lives.** A policy rather than part of the theme: it says how strictly *any* theme this organisation saves is judged, and it outlives the theme it was set beside. It changes what the doctor reports — `enforced` on the rule, `enforcedRulesHold` on the report — and never whether a save is accepted.
- **An unreadable settings file answers with its revision, and only to an instance administrator.** The parser's own message goes to the log: it describes a file the caller did not write and, in the YAML case, quotes from it. The revision is what is needed to act — it is the `expectedRevision` of the `PUT` that overwrites the file — so a downgrade is repaired through the API rather than by editing a repository by hand.

Two costs this shape carries on purpose:

- **Every additive change to a settings document is a version bump, and therefore a hard break for a downgraded server.** `version` is a literal and every object states `additionalProperties: false`, so a release that adds one optional field writes documents the *previous* release refuses outright — not "ignores the field", refuses. That is the deliberate trade: the alternative, an open document read leniently, is how a setting an older server silently dropped becomes a policy nobody chose, and this platform would rather refuse than apply half a configuration. It is only affordable because the refusal is recoverable: an unreadable file is reported rather than replaced, with its revision, and an instance administrator overwrites it through the API (above) or restores an earlier revision of it. Downgrading therefore costs one deliberate save, not a lost configuration — and the same is true in reverse, which is why a field expected soon is better added now than in the release that needs it (`logo`, below).
- **`logo.hash` names a blob nothing can store or serve yet.** `BlobStore` is a declared port with no implementation on `AppDependencies` until the attachments work merges, so a hash saved here resolves to nothing: the field validates, round trips and travels, and the mark does not render. It is in the document from the start because onboarding's first step is "upload a logo" (ADR-028) and, by the paragraph above, adding it later would be a version bump for every instance. Marked `TODO(M3)` at the field.
