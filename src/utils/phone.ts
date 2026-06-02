/** Digits-only phone key (shared by store credit, loyalty, lay-bys). */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function isValidPhoneDigits(digits: string): boolean {
  return digits.length >= 9 && digits.length <= 15
}
