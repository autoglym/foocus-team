import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import { startDownloadTokenRefresh } from '@/lib/api';

/** Landing page for /login/google#token=… or #error=… after Google sign-in. */
export function GoogleCallback() {
  const navigate = useNavigate();
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Remove the token from the address bar and history right away
    window.history.replaceState(null, '', window.location.pathname);
    const token = params.get('token');
    if (token) {
      localStorage.setItem('token', token);
      hydrate();
      startDownloadTokenRefresh();
      navigate('/', { replace: true });
    } else {
      navigate('/login', { replace: true, state: { googleError: params.get('error') || 'Google sign-in failed' } });
    }
  }, [hydrate, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slack-surface text-slack-hint">
      Signing you in…
    </div>
  );
}
