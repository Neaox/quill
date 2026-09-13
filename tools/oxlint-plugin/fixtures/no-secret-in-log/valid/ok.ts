const logger = { info: (..._args: unknown[]): void => {} }

export function logLogin(userId: string): void {
  logger.info('login', { userId })
}
