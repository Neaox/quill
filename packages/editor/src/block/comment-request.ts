/** A comment was asked for on a range of the document; anchoring it is the application's (ADR-022). */
export interface CommentRequest {
  readonly from: number
  readonly to: number
  readonly text: string
}
