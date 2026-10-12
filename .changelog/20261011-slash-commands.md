Added: The editor's slash menu offers every block Quill's Markdown supports, in groups (text, blocks, media and diagrams, code, data, references, templates), each with an icon, a one-line description and the Markdown shortcut that makes the same block.
Added: The slash menu ranks matches (label prefix, word starts, keywords and aliases, then letters in order), marks the matched letters, shows recently used blocks first, and announces how many blocks match.
Added: Blocks that need an answer ask for it inside the menu: a code block's language, a badge's tone, one of the organisation's labels, an emoji, or a document to link to by its id; an SVG drawing opens the upload dialog for SVGs.
Added: Markdown typed at the start of a line becomes its block (`## `, `- `, `1. `, `[] `, `> `, `---`, a code fence), and Backspace straight after gives the typed text back.
Added: An empty line says "Type / for blocks", and a "+" beside the caret's block opens the same menu.
Added: Features and Markdown extensions add items to the slash menu through `SlashContribution`s (`createSlashRegistry`), documented in the extension guide.
Changed: A block chosen from the slash menu replaces the empty line it was typed on, puts the caret in the new block, and one undo removes it and gives the typed `/query` back.
Fixed: A container directive with nothing in it (`:::callout` followed by `:::`) no longer stops the editor opening the document.
