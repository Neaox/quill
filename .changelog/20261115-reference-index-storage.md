Added: A workspace's reference index now stores the code and schema artifacts it ingests, with the source commit and capture time, and serves them on `/w/:workspaceSlug/reference` through a new API. The page browses namespaces and tables with their comments, or searches code symbols, and fetches the artifact only when asked.
Added: The code index reads `.tsx` components, so the app's components appear in the reference alongside the packages.
Added: Class methods, accessors and properties are indexed as symbols under their class, with a qualified name and a link back to the class symbol.
Added: A declaration's `{@link}` and `@see` targets are indexed as edges, resolved to a symbol's moniker where the name is unambiguous, and shown as "See also" in the Reference page and the local report.
