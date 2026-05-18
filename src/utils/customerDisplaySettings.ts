import type { ICustomerDisplayConfig } from '../models/StoreSettings.js'

export const DEFAULT_CUSTOMER_DISPLAY: ICustomerDisplayConfig = {
  enabled: true,
  idle: {
    headline: 'Welcome',
    subtext: '',
    imageUrl: '',
  },
  theme: {
    backgroundColor: '#0f1419',
    accentColor: '#3b82f6',
  },
  footerText: 'All prices include VAT',
}

function trim(s: unknown, max: number): string {
  return String(s ?? '')
    .trim()
    .slice(0, max)
}

function hexColor(raw: unknown, fallback: string): string {
  const s = trim(raw, 32)
  return /^#[0-9A-Fa-f]{6}$/.test(s) ? s : fallback
}

export function mergeCustomerDisplay(raw: unknown): ICustomerDisplayConfig {
  const d = DEFAULT_CUSTOMER_DISPLAY
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const idleRaw = o.idle && typeof o.idle === 'object' ? (o.idle as Record<string, unknown>) : {}
  const themeRaw = o.theme && typeof o.theme === 'object' ? (o.theme as Record<string, unknown>) : {}
  return {
    enabled: o.enabled === false ? false : true,
    idle: {
      headline: trim(idleRaw.headline, 120) || d.idle.headline,
      subtext: trim(idleRaw.subtext, 400),
      imageUrl: trim(idleRaw.imageUrl, 2000),
    },
    theme: {
      backgroundColor: hexColor(themeRaw.backgroundColor, d.theme.backgroundColor),
      accentColor: hexColor(themeRaw.accentColor, d.theme.accentColor),
    },
    footerText: trim(o.footerText, 200) || d.footerText,
  }
}

export function customerDisplayFromBody(body: unknown): ICustomerDisplayConfig | null {
  if (body === undefined || body === null) return null
  return mergeCustomerDisplay(body)
}
