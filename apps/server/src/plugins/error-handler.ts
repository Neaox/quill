import type { FastifyError, FastifyInstance } from 'fastify'

import { AppError } from '../errors.ts'
import { redactShareToken } from './logging.ts'

interface ErrorBody {
  readonly error: {
    readonly code: string
    readonly message: string
    details?: unknown
  }
}

/**
 * Every error response, expected or not, has the shape
 * `{ error: { code, message, details? } }` (task requirement). `AppError`
 * carries its own status and code; a Fastify schema-validation failure
 * becomes a `400 validation_error`; anything else is logged and reported as
 * a generic `500` without leaking internals.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      // A 304 answers with headers only; anything else would be a body the
      // client is being told it already has.
      if (error.statusCode === 304) {
        reply.status(304).send()
        return
      }
      const body: ErrorBody = { error: { code: error.code, message: error.message } }
      if (error.details !== undefined) {
        body.error.details = error.details
      }
      reply.status(error.statusCode).send(body)
      return
    }

    if (error.validation !== undefined) {
      reply.status(400).send({
        error: { code: 'validation_error', message: error.message, details: error.validation },
      })
      return
    }

    request.log.error(error)
    reply.status(500).send({ error: { code: 'internal_error', message: 'Internal Server Error' } })
  })

  // The URL is echoed so a caller can see which route it missed — and a
  // share link carries its token *in* the URL, so the token is taken out
  // first. A trailing slash or a page address is enough to miss every route
  // and land here, which is precisely how an unredacted message would put a
  // live capability into a response, a proxy log, and a bug report
  // (ADR-011; `plugins/logging.ts`).
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: `Route ${request.method}:${redactShareToken(request.url)} not found`,
      },
    })
  })
}
