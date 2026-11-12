const z = {
  object: (shape: unknown) => shape,
  string: () => 'string',
  boolean: () => 'boolean',
  nullable: (value: unknown) => value,
  array: (value: unknown) => value,
  output: <T>(value: T): T => value,
}

export const ACCOUNT_OPENING = z.object({
  open: z.boolean(),
  changedAt: z.nullable(z.string()),
  changedBy: z.nullable(z.string()),
  reason: z.nullable(z.string()),
  history: z.array(
    z.object({
      open: z.boolean(),
      changedAt: z.string(),
      changedBy: z.string(),
      reason: z.string(),
    }),
  ),
})

export type AccountOpening = z.output<typeof ACCOUNT_OPENING>
