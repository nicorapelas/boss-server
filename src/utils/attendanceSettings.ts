import type { IStoreSettings } from '../models/StoreSettings.js'

export type StaffAttendanceSettings = {
  enabled: boolean
  logoutClockOutPromptEnabled: boolean
  /** Prompt on till sign-out only after this many minutes clocked in; 0 = always when clocked in. */
  logoutPromptAfterMinutes: number
  /** When enabled, first sale after autoClockOutTime closes an open attendance session at sale time. */
  autoClockOutEnabled: boolean
  /** Local store time HH:mm (24h), e.g. 18:00 */
  autoClockOutTime: string
}

const AUTO_CLOCK_OUT_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

export const DEFAULT_AUTO_CLOCK_OUT_TIME = '18:00'

export const DEFAULT_STAFF_ATTENDANCE: StaffAttendanceSettings = {
  enabled: true,
  logoutClockOutPromptEnabled: true,
  logoutPromptAfterMinutes: 0,
  autoClockOutEnabled: false,
  autoClockOutTime: DEFAULT_AUTO_CLOCK_OUT_TIME,
}

export function parseAutoClockOutTime(raw: string | undefined | null): string | null {
  const s = raw?.trim()
  if (!s || !AUTO_CLOCK_OUT_TIME_RE.test(s)) return null
  const [, h, m] = s.match(AUTO_CLOCK_OUT_TIME_RE)!
  return `${h.padStart(2, '0')}:${m}`
}

/** True when `at` is on or after today's auto clock-out cutoff (local server time). */
export function isAfterAutoClockOutTime(at: Date, timeHHmm: string): boolean {
  const parsed = parseAutoClockOutTime(timeHHmm)
  if (!parsed) return false
  const [, h, m] = parsed.match(/^(\d{2}):(\d{2})$/)!
  const cutoff = new Date(at)
  cutoff.setHours(Number(h), Number(m), 0, 0)
  return at.getTime() >= cutoff.getTime()
}

export function attendanceFromSettings(
  doc: Pick<IStoreSettings, 'staffAttendance'> | null | undefined,
): StaffAttendanceSettings {
  const raw = doc?.staffAttendance
  const minutes = Number(raw?.logoutPromptAfterMinutes)
  const autoTime = parseAutoClockOutTime(raw?.autoClockOutTime) ?? DEFAULT_AUTO_CLOCK_OUT_TIME
  return {
    enabled: raw?.enabled !== false,
    logoutClockOutPromptEnabled: raw?.logoutClockOutPromptEnabled !== false,
    logoutPromptAfterMinutes:
      Number.isFinite(minutes) && minutes >= 0 ? Math.min(Math.floor(minutes), 24 * 60) : 0,
    autoClockOutEnabled: raw?.autoClockOutEnabled === true,
    autoClockOutTime: autoTime,
  }
}
