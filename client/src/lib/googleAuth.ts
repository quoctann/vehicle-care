const googleErrors = [
  'cancelled',
  'expired',
  'email_exists',
  'identity_linked',
  'already_linked',
  'unavailable',
  'failed',
] as const;
export type GoogleAuthError = (typeof googleErrors)[number];

/** Never render provider-supplied descriptions or retain OAuth credentials in history. */
export function googleCallback(search: string) {
  const params = new URLSearchParams(search);
  const rawError = params.get('google_error');
  const error: GoogleAuthError | null =
    rawError === null ? null : (googleErrors.find((code) => code === rawError) ?? 'failed');
  const linked = error === null && params.get('google') === 'linked';
  for (const key of [
    'google_error',
    'google',
    'code',
    'state',
    'error',
    'error_description',
    'scope',
    'authuser',
    'prompt',
  ])
    params.delete(key);
  const clean = params.toString();
  return { error, linked, cleanSearch: clean ? `?${clean}` : '' };
}

export function trustedGoogleAuthorizationUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Google authorization URL.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'accounts.google.com' ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error('Invalid Google authorization URL.');
  return url.href;
}
