# Research phase

Time-boxed investigations that run alongside repository bootstrap (milestone M0). Each produces findings, a recommendation, trade-offs, a spike in `spikes/` where useful, and an ADR. See `quill-plan.md`, Part V.

Copy `0000-template.md` to start a write-up.

| #   | Investigation                                                                       | Write-up                       | ADR           | Status      |
| --- | ----------------------------------------------------------------------------------- | ------------------------------ | ------------- | ----------- |
| R1  | Competitive analysis (now including comments, sharing, public publishing, Git sync) | `r01-competitive-analysis.md`  | 001           | Not started |
| R2  | Markdown and AST                                                                    | `r02-markdown-ast.md`          | 002, 004, 005 | Not started |
| R3  | Editor spike: TipTap with an mdast converter                                        | `r03-editor.md`                | 003           | Done        |
| R4  | Content store spike: Git engine, backends, layout, performance                      | `r04-content-store.md`         | 014, 015      | Done        |
| R5  | Draft locking spike                                                                 | `r05-draft-locking.md`         | 021           | Done        |
| R6  | Tenancy and permissions                                                             | `r06-tenancy-permissions.md`   | 012           | Not started |
| R7  | Comment anchoring                                                                   | `r07-comment-anchoring.md`     | 022           | Not started |
| R8  | Public publishing and SSR                                                           | `r08-public-publishing.md`     | 023           | Not started |
| R9  | Search                                                                              | `r09-search.md`                | 010           | Not started |
| R10 | Provider architecture and source references                                         | `r10-providers.md`             | 008           | Not started |
| R11 | Embeds                                                                              | `r11-embeds.md`                | 009           | Not started |
| R12 | Operations and threat model                                                         | `r12-operations.md`            | 018, 024      | Not started |
| R13 | Frontend architecture and design system                                             | `r13-frontend.md`              | 013, 019      | Done        |
| R14 | Interactive documents and source artifacts                                          | `r14-interactive-artifacts.md` | 006, 007      | Not started |

Critical path: R3, R4, R5. Time box for R1 to R9: four weeks.

## Where the spike code went

The spikes these write-ups came from (`spikes/r3-editor-converter`, `spikes/r4-content-store`, and the rest) were throw-away by design and were removed once their ADRs were accepted, as the contributing guide requires. They are kept in history for the record: commit `10f0339` ("Bootstrap Quill: plan, foundation, and the first writing and reading surfaces") carries the full `spikes/` directory, and `git show 10f0339:spikes/r4-content-store/README.md` (or a checkout of that commit) brings any of them back.

