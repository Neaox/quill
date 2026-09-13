const logger = { info: (..._args: unknown[]): void => {} }

export function logLogin(password: string): void {
  logger.info('login', { password })
}
