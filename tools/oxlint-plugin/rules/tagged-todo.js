/**
 * quill/tagged-todo
 *
 * A `TODO` or `FIXME` comment must carry a tag in parentheses naming the
 * milestone, ADR, or issue that will resolve it (`TODO(M5)`, `TODO(ADR-032)`,
 * `TODO(#123)`), so nothing is left untracked (plan section 34).
 *
 * Heuristic: scans every comment in the file (line and block) for the whole
 * word `TODO` or `FIXME` and requires it to be immediately followed by a
 * non-empty `(...)` tag. `TODO` or `FIXME` appearing as part of a longer
 * word (`TODOIST`) is ignored via a word boundary. Prose that merely
 * discusses "a todo list" without the tag-shaped keyword is not flagged.
 *
 * No auto-fix: the rule cannot know what tag belongs there.
 */

const UNTAGGED_MARKER = /\b(TODO|FIXME)\b(\([^)]*\))?/g

const rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'require TODO/FIXME comments to carry a tracking tag' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          UNTAGGED_MARKER.lastIndex = 0
          let match
          while ((match = UNTAGGED_MARKER.exec(comment.value)) !== null) {
            const tag = match[2]
            if (tag && tag !== '()') continue
            // `comment.value` starts right after the 2-character `//` or
            // `/*` marker, which is why that offset lines up with the
            // match's real position in the source file.
            const offset = comment.range[0] + 2 + match.index
            context.report({
              loc: { start: context.sourceCode.getLocFromIndex(offset) },
              message: `Tag this ${match[1]} with a milestone, ADR, or issue, for example ${match[1]}(M5).`,
            })
          }
        }
      },
    }
  },
}

export default rule
