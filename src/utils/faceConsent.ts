/** Bump when store-level face-login disclaimer text changes materially. */
export const POS_FACE_LOGIN_CONSENT_VERSION = 'pos-face-login-v1'

/** Bump when staff enrollment consent text changes materially. */
export const STAFF_FACE_ENROLLMENT_CONSENT_VERSION = 'staff-face-enroll-v1'

export function isPosFaceLoginConsentValid(
  consent: { version?: string } | null | undefined,
): boolean {
  return consent?.version === POS_FACE_LOGIN_CONSENT_VERSION
}
