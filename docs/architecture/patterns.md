# Patterns catalogue

The named patterns this codebase uses to manage complexity, where each one lives, and the naming convention that makes it recognisable. A pattern is chosen because it makes the next reader's job easier, never for its own sake; if a module uses one and the name does not make it obvious, its doc comment says which.

## The tie-breaker

**When otherwise equal, the well-known approach wins.** A novel approach carries a cost that never appears in its own code: every future reader has to stop and learn it. A well-known pattern is understood on sight. So the burden of proof sits with novelty. A novel design is acceptable only when it has substantial, demonstrable benefits over the familiar one for this codebase, and when it does, the module documents what the benefit is and what a reader should expect, so the learning cost is paid once, on purpose, rather than by every reader in surprise.

The same rule applies in the other direction: do not apply a pattern where a plain function or a constant is the familiar thing. Shoehorning a pattern is also novelty from the reader's point of view.

## Naming conventions

| Pattern | How it is spelled here |
|---|---|
| Factory | `createX(options)` returns a ready-to-use `X`. A factory that yields per-key instances is a **provider**: `XProvider.forWorkspace(id)` |
| Port and adapter | The hexagonal name for a **boundary** interface between the application core and the outside world: `ContentStore`, `BlobStore`, `Mailer`, the repositories, in `packages/application/src/ports`. Implementations are adapters named for how they work: `FilesystemObjectStore`, `SmtpMailer`. A factory chooses the adapter from configuration: `createMailer(config)`. Neither word appears in a type name; the folder and the doc comment say it |
| Strategy | The Gang of Four name for interchangeable algorithms chosen at runtime **inside** a package, with no boundary involved: the theme doctor's rules, the highlight presentations, the merge algorithm. A port is usually built with the Strategy shape, but "port" says where it sits and "strategy" says only that it is swappable; use the word that carries the meaning |
| Registry | A frozen record or map named `X_REGISTRY` or `KNOWN_X`, plus `registerX` where registration is dynamic, and a `findX(name)` lookup |
| Observer | `subscribe(listener): () => void`, `on(event, handler)`, or an outbox consumer registered by event type; the return value is always the unsubscribe |
| Command | A use case class or function named as an imperative verb phrase (`PublishDocument`, `RestoreRevision`) with one `execute` |
| Repository and unit of work | `XRepository` ports with `UnitOfWork.run(callback)` binding them to one transaction |
| Reducer and state machine | `xReducer(state, event)` pure, with `initialXState`; the states are a discriminated union |
| Result | `Result<T, E>` with `ok()` and `err()` for expected failures; exceptions only for programmer errors |
| Builder | Fluent and immutable: `aDocument().withTitle('…').published().build()`. Each `withX` returns a new builder so partial builders can be shared; `build()` validates and returns the finished value or a `Result`. Test data builders live in each package's `test-support` |
| Composition root | One file per process that wires factories together: `apps/server/src/dependencies.ts`, `apps/web/src/app/app.tsx` |

## Port or strategy? The decision rule

Ask one question: **does the interface separate the application core from something outside it?**

- **Yes: it is a port.** The thing behind it is I/O, a service, storage, time, identity, the network, a browser API. It lives in `packages/application/src/ports` (or a package's own `ports/` folder when the boundary is internal to that package), its implementations are adapters in an infrastructure layer, and a factory picks the adapter from configuration. Tests substitute a fake adapter. Examples: `ContentStore`, `BlobStore`, `SearchIndex`, `Mailer`, `KeyProvider`, `IdentityProvider`, `Clock`, `IdGenerator`, every repository, the editor's `DraftClient` and `LockClient`, the highlight client's `HighlightEnvironment`.
- **No: it is a strategy.** Both sides are inside the core and pure; the interface exists only so an algorithm can be swapped or listed. Examples: the theme doctor's `Rule`, the highlight presentations (ranges or markup), the merge algorithm, a sort or ranking policy. Tests exercise the real implementations.

Consequences of the rule:

| | Port | Strategy |
|---|---|---|
| Where the interface lives | `ports/` | beside its implementations |
| Where implementations live | infrastructure or adapters | the same package |
| Who chooses the implementation | a factory reading configuration, at the composition root | the caller, or a registry, at the point of use |
| What tests do | inject a fake adapter | run the real implementations |
| Naming | `Mailer`, `SmtpMailer`, `DevMailer` | `Rule`, `contrastRule`, `bandsRule` |
| Never | `MailerPort`, `MailerStrategy` | `RuleStrategy` |

If you cannot answer the question, the interface is probably premature: keep the concrete function until a second, real implementation makes the boundary or the swap obvious.

## Where each pattern lives

**Ports and adapters (hexagonal).** The architecture-level strategy pattern. `packages/application/src/ports` declares `ContentStore`, `BlobStore`, `SearchIndex`, `Clock`, `IdGenerator`, `KeyProvider`, `IdentityProvider`, and the repository ports; `packages/content-store`, `packages/search`, and `apps/server/src/infrastructure` implement them. Routes call use cases; use cases call ports; nothing above a port knows which adapter is behind it.

**Factory and strategy together.** The idiom `factory.make(variables).doThing(variables)` appears as:

- `ObjectStoreProvider.forWorkspace(workspaceId)` yields the `ObjectStore` for one workspace, on whichever backend configuration chose; `GitContentStore` then calls `publish` on it.
- `createMailer(config)` yields `DevMailer` or `SmtpMailer`; `createKeyProvider(config)` yields the environment, file, or cloud implementation.
- `identityProvider(preset, config).startSignIn(orgId, returnTo)`: one OIDC implementation, providers as data presets (ADR-011).
- `createApiClient(options)` in the web app, and `createQueryClient()`.

**Registry.** Things the product can be extended with are registries so adding one is adding an entry, not a code path: Markdown directives (`KNOWN_DIRECTIVES`, each a `DirectiveDefinition` with `parse`, `validate`, `serialize`), live block types (ADR-032), identity provider presets, template question types, the highlight grammars (`SUPPORTED_LANGUAGES`, `resolveLanguage`), the theme doctor's rules (`ALL_RULES`, each a `Rule` object with `evaluate`), the slash menu items (`SLASH_ITEMS`).

**Observer.** Anything that reacts to change without the source knowing who listens: the transactional outbox and its consumers (`registerConsumer(eventType, handler)`), presence and lock events (`LockEvent` through `useDocumentLock`), the editor's stores (`createSlashStore().subscribe`), TanStack Query subscriptions on the client, and later server-sent events for live blocks. The producer never calls a subscriber by name.

**Command.** Every state change with meaning is a use case with one entry point: `CreateDocument`, `PublishDocument`, `RestoreRevision`, `AcquireLock`. Publish is the command the review workflow later wraps (ADR-015). Editor operations are ProseMirror commands (`setBlockWidth`, `moveBlock`, `insertMarkdown`), pure functions of state and a transaction.

**Repository and unit of work.** `apps/server/src/infrastructure/repositories`, one file per port, bound to a transaction by `createUnitOfWork(db).run(...)`, so a use case never sees a connection.

**Reducer and state machine.** The lock lifecycle (`lockReducer`, states such as `holding`, `expired`, `taken-over`), autosave status, the template progress calculation. States are discriminated unions so an impossible state does not compile.

**Pipeline (chain of responsibility).** The Markdown pipeline is `unified` plugins in a fixed order (parse, directives, sanitise, render); the highlight path is tokenize, pack, apply; the theme generator is neutral ramp, accent, status, syntax, then doctor rules. Each stage takes the previous stage's output and nothing else.

**Template method.** `DirectiveDefinition`, `Rule`, and live block types define a fixed set of operations that every member implements; the framework calls them in a fixed order. Adding a member never changes the caller.

**Builder.** The fluent form, `builder.withX().withY().build()`, is used where construction has many optional parts, invariants between them, or steps that must validate before the value exists, and where a typed options object would be a wall of optional fields. Two places earn it:

- **Test data builders**, the strongest case. Every package's `test-support` offers builders for its main types (`aUser()`, `aDocument()`, `aGrant()`, `aThemeDocument()`) with sensible defaults, so a test states only what matters to it: `aDocument().inCollection(runbooks).published().build()`. Builders are immutable, so a fixture such as `const publishedAdr = aDocument().ofTemplate(adr).published()` can be shared and refined per test without leaking state.
- **Production values with invariants**, such as a theme document (`forkTheme` grows into `themeBuilder(base).withAccent(hue).withTone('warm').build()`, running the doctor in `build()`), a search query, or a publish request assembled across several steps.

Where a value has a handful of fields and no invariants, a typed options object with defaults is the idiomatic TypeScript and a builder would be ceremony. Functions that assemble a structure in one step and return a `Result`, such as `buildScopeChain(input)`, are named with `build` but are not builders in this sense; they are constructors that can fail.

**Decorator.** Fastify plugins (`registerSessionSupport`, `registerErrorHandler`, `registerOpenApi`) wrap the request pipeline; ProseMirror decorations paint comments over text without changing the document (ADR-022).

**Memoisation and caching as first-class objects.** The LRU in `packages/highlight`, the render cache (ADR-031), and the theme's `resolveTokenClass` memo return the identical object on a hit so downstream identity checks skip work.

## When not to reach for a pattern

- A registry with one entry is a constant.
- A strategy with one implementation is a function, until the second implementation is real.
- An observer whose only subscriber is the caller is a return value.
- A factory that only calls a constructor is the constructor.

The rule of three applies: name the pattern when the third instance appears, and refactor the first two to match.
