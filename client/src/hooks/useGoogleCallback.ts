import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { googleCallback } from '@/lib/googleAuth';

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
