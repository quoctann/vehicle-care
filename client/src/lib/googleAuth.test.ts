import { describe, expect, it } from 'vitest';
import { googleCallback, trustedGoogleAuthorizationUrl } from './googleAuth';

describe('Google callback feedback', () => {
  it.each([
    'cancelled',
    'expired',
    'email_exists',
    'identity_linked',
    'already_linked',
    'unavailable',
    'failed',
  ])('allowlists %s without exposing URL content', (code) => {
    expect(googleCallback(`?google_error=${code}&code=secret&state=secret&tab=account`)).toEqual({
      error: code,
      linked: false,
      cleanSearch: '?tab=account',
    });
  });
  it('maps arbitrary errors to failed and removes OAuth query material', () => {
    expect(
      googleCallback(
        '?google_error=%3Cscript%3E&error_description=secret&scope=email&authuser=0&prompt=consent',
      ),
    ).toEqual({ error: 'failed', linked: false, cleanSearch: '' });
  });
  it('recognizes only explicit link success and gives errors precedence', () => {
    expect(googleCallback('?google=linked').linked).toBe(true);
    expect(googleCallback('?google=unknown').linked).toBe(false);
    expect(googleCallback('?google=linked&google_error=failed').linked).toBe(false);
    expect(googleCallback('')).toEqual({ error: null, linked: false, cleanSearch: '' });
  });
});

describe('Google authorization navigation', () => {
  it('accepts the Google HTTPS authorization endpoint', () => {
    expect(
      trustedGoogleAuthorizationUrl('https://accounts.google.com/o/oauth2/v2/auth?state=test'),
    ).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=test');
  });
  it.each([
    null,
    undefined,
    '',
    1,
    'javascript:alert(1)',
    'http://accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com.evil.test/',
    'https://accounts.google.com@evil.test/',
    'https://user@accounts.google.com/',
    'https://accounts.google.com:444/',
  ])('rejects unsafe authorization target %s', (url) => {
    expect(() => trustedGoogleAuthorizationUrl(url)).toThrow();
  });
});
