import { STATUS_CODES } from 'node:http'

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

type ValidationIssue = NonNullable<FastifyError['validation']>[number]

/**
 * The dotted path to the field a problem is about. A missing property has no
 * path of its own, only the schema's name for it, which is added to the path of
 * the object it is missing from.
 */
function field({ instancePath, params }: ValidationIssue): string {
  const missing = params['missingProperty']
  const steps = instancePath.split('/').filter((step) => step !== '')
  return (typeof missing === 'string' ? [...steps, missing] : steps).join('.')
}

/**
 * What a person reads when a request fails its schema: the fields at fault,
 * not the validator's phrasing (`body/email must match format "email"`),
 * which names a request body nobody on the other end wrote. The validator's
 * own findings stay in `details`, for a client that wants to place them.
 */
function describeValidation(validation: readonly ValidationIssue[]): string {
  const fields = new Set(validation.map(field).filter((name) => name !== ''))
  return fields.size === 0
    ? 'The request was not valid.'
    : `The request was not valid: ${[...fields].join(', ')}.`
}

/**
 * The stable codes for the client errors Fastify raises itself, before a
 * route runs; any other 4xx is `bad_request`. Keyed by Fastify's own error
 * code where one status covers several causes, so a malformed body and a
 * missing one can be told apart without parsing a message.
 */
const CLIENT_ERROR_CODES: Readonly<Record<string, string>> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'invalid_body',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'invalid_body',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'invalid_body',
}

const CLIENT_ERROR_CODES_BY_STATUS: Readonly<Record<number, string>> = {
  404: 'not_found',
  405: 'method_not_allowed',
  406: 'not_acceptable',
  408: 'request_timeout',
  413: 'payload_too_large',
  414: 'uri_too_long',
  415: 'unsupported_media_type',
  431: 'request_header_fields_too_large',
}

/** A client error's status, or undefined when this error is the server's fault. */
function clientStatus(error: FastifyError): number | undefined {
  const status = error.statusCode
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined
}

function clientErrorCode(error: FastifyError, status: number): string {
  return CLIENT_ERROR_CODES[error.code] ?? CLIENT_ERROR_CODES_BY_STATUS[status] ?? 'bad_request'
}

/**
 * Every error response, expected or not, has the shape
 * `{ error: { code, message, details? } }` (task requirement). `AppError`
 * carries its own status and code; a Fastify schema-validation failure
 * becomes a `400 validation_error`; a request Fastify itself refused — an
 * unsupported or malformed body, one too large — keeps its 4xx, with a stable
 * code and the status's standard phrase as the message, because Fastify's
 * own text can echo what the client sent; anything else is logged and
 * reported as a generic `500` without leaking internals.
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
        error: {
          code: 'validation_error',
          message: describeValidation(error.validation),
          details: error.validation,
        },
      })
      return
    }

    const status = clientStatus(error)
    if (status !== undefined) {
      // The client's mistake, not a fault: worth a line, not an alert.
      request.log.info({ err: error }, 'request refused')
      reply.status(status).send({
        error: {
          code: clientErrorCode(error, status),
          message: STATUS_CODES[status] ?? 'Bad Request',
        },
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
