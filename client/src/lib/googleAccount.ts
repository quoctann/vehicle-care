import * as api from '@/api/client';
import { assertCurrentSyncSession, type SyncSessionContext } from '@/sync/sessionGuard';
import { trustedGoogleAuthorizationUrl } from './googleAuth';

/** Load status for the captured session and reject stale or malformed responses. */
export async function loadGoogleStatus(context: SyncSessionContext) {
  assertCurrentSyncSession(context);
  const status = await api.getGoogleStatus(context.accountId);
  assertCurrentSyncSession(context);
  if (
    !status ||
    typeof status.enabled !== 'boolean' ||
    typeof status.linked !== 'boolean' ||
    typeof status.has_password !== 'boolean'
  )
    throw new Error('Invalid Google account status.');
  return status;
}

/**
 * Reauthenticate and create a link transaction without changing local data.
 * Validate both session generations and the backend-returned navigation target.
 */
export async function beginGoogleLink(context: SyncSessionContext, password: string) {
  assertCurrentSyncSession(context);
  const response = await api.linkGoogle({ password, expected_account_id: context.accountId });
  assertCurrentSyncSession(context);
  return trustedGoogleAuthorizationUrl(response.authorization_url);
}
