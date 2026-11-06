import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseEmailActionLink } from '@/lib/emailActions';

/** Keep a token only in component memory and replace its browser history entry. */
export function useEmailActionToken() {
  const location = useLocation();
  const navigate = useNavigate();
  const href = `${location.pathname}${location.search}${location.hash}`;
  const [link, setLink] = useState(() => ({
    ...parseEmailActionLink(href),
    actionKey: location.key,
  }));
  const hasToken =
    new URLSearchParams(location.search).has('token') ||
    new URLSearchParams(location.hash.slice(1)).has('token');
  // A new link on the same route is a new action. Our own token-free history
  // replacement must not discard the token retained in component memory.
  if (hasToken && location.key !== link.actionKey) {
    setLink({ ...parseEmailActionLink(href), actionKey: location.key });
  }
  useEffect(() => {
    if (`${location.pathname}${location.search}${location.hash}` !== link.cleanUrl) {
      navigate(link.cleanUrl, { replace: true, state: null });
    }
  }, [navigate, link.cleanUrl, location.pathname, location.search, location.hash]);
  return link;
}
