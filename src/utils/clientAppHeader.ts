import type { Request } from 'express'

export const CLIENT_APP_SOURCES = ['shop-assist', 'back-office', 'pos', 'scan'] as const
export type ClientAppSource = (typeof CLIENT_APP_SOURCES)[number] | 'unknown'

export function parseClientAppHeader(req: Request): ClientAppSource {
  const raw =
    typeof req.headers['x-client-app'] === 'string'
      ? req.headers['x-client-app'].trim().toLowerCase()
      : ''
  if ((CLIENT_APP_SOURCES as readonly string[]).includes(raw)) {
    return raw as ClientAppSource
  }
  return 'unknown'
}
