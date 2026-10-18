/**
 * Why an outbound request did not give an answer (ADR-011, ADR-042).
 *
 * In a module of its own because both outbound clients, the shared clock and the
 * limiter raise it, and none of them may need another's file to do so.
 */
export type OutboundFailure =
  | 'host_not_allowed'
  | 'scheme_not_allowed'
  | 'private_address'
  | 'dns_failure'
  | 'too_many_redirects'
  | 'redirect_without_location'
  | 'redirect_not_followed'
  | 'invalid_url'
  | 'credentials_in_url'
  | 'port_not_allowed'
  | 'content_type_not_allowed'
  | 'content_encoding_not_allowed'
  | 'credentials_in_request'
  | 'response_too_large'
  | 'blocked_by_policy'
  | 'too_busy'
  | 'timeout'
  | 'network_error'

export class OutboundRequestError extends Error {
  readonly reason: OutboundFailure

  constructor(reason: OutboundFailure, message: string) {
    super(message)
    this.name = 'OutboundRequestError'
    this.reason = reason
  }
}
