Security: a drawing's transform, colour and draw.io values are checked in linear time, so an uploaded SVG or draw.io file can no longer tie up the server for seconds or minutes while it is drawn.
Security: a drawing keeps only the classes the reading stylesheet styles and the organisation's label names, so it cannot use the application's own layout classes to cover the page.
Security: a drawing carries only data attributes from its extension, never a source, a handler or a role.
Security: an image's address is normalised as a link's is, so `/\host` stays a path on this site.
Security: the people directory behind the owner picker finds and names only people who can view the document, answers no query shorter than two characters, and has a budget per person.
Security: the navigation tree, its pages and child pages lists have a budget per person, and a reference too long to name a document is refused.
Security: a child pages list reads where each page is now on every request, so a page moved somewhere restricted disappears at once on every server.
Security: on the public site and share links, an address of this application in any spelling a browser opens (the other scheme, `www.`, capitals, surrounding space) is readdressed or reduced to its words, never handed to a stranger.
Security: saving a new version of an attachment that a published page shows needs permission to publish that page and the one that owns the file.
Security: a page's icon is one emoji or none, so no words can be put beside a title.
Security: a response compressed by the server is compressed after every other hook, so one that sets a cookie is never compressed.
Fixed: a child pages list stops at 500 pages and says that more are not listed.
Fixed: a compressed response carries its own validator for each encoding, and still revalidates to 304.
Fixed: a response that already varies on several headers keeps all of them when it is compressed.
Fixed: a page of the navigation tree answers the same "not found" whether the parent names nothing, is in another workspace, or is hidden.
Added: `BROWSE_RATE_LIMIT_MAX` sets the per-session budget for the navigation tree and child pages lists (600 a minute by default).
Fixed: when saving a diagram needs permission to publish, the diagram editor says why and offers to save your work as a new diagram instead of a "Try again" that cannot succeed.
