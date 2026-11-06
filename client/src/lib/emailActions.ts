import { useSessionStore, type SessionAccount, type SessionStatus } from '@/stores/useSessionStore';

/** Fragment tokens never reach HTTP logs. Query support is legacy-only. */
export function parseEmailActionLink(href: string) {
  const url = new URL(href, 'https://local.invalid');
  const fragment = new URLSearchParams(url.hash.slice(1));
  const source = fragment.has('token') ? fragment : url.searchParams;
  const tokens = source.getAll('token');
  const token = tokens.length === 1 ? tokens[0] : '';
  url.searchParams.delete('token');
  return { token, cleanUrl: `${url.pathname}${url.search}` };
}

export function isValidPassword(password: string): boolean {
  const bytes = new TextEncoder().encode(password).byteLength;
  return bytes >= 8 && bytes <= 72;
}

export async function refreshEmailActionSession(
  context: { account: SessionAccount | null; sessionGeneration: number; status?: SessionStatus },
  clearExpired: boolean,
) {
  if (!context.account && !(clearExpired && context.status === 'loading')) return;
  await useSessionStore
    .getState()
    .refreshCurrentAccount(context.account?.id ?? null, context.sessionGeneration, clearExpired);
}
