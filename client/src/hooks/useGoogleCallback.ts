import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { googleCallback } from '@/lib/googleAuth';

/**
 * Handles the backend's redirect back to React, not Google's code callback.
 * It exposes allowlisted feedback and removes OAuth parameters from history;
 * authentication is established separately by session hydration.
 */
export function useGoogleCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const [feedback] = useState(() => googleCallback(location.search));
  useEffect(() => {
    const { cleanSearch } = googleCallback(location.search);
    if (cleanSearch !== location.search)
      navigate(
        { pathname: location.pathname, search: cleanSearch, hash: location.hash },
        { replace: true, state: location.state },
      );
  }, [location, navigate]);
  return feedback;
}
