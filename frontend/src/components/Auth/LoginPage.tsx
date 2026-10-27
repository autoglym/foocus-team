import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import { Button } from '@/components/ui/button';
import { APP_NAME, Wordmark } from '@/components/Brand';
import { Input } from '@/components/ui/input';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const location = useLocation();
  const [error, setError] = useState<string>((location.state as { googleError?: string } | null)?.googleError ?? '');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/auth/google/enabled')
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data: { enabled: boolean }) => setGoogleEnabled(data.enabled))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      const errorMap: Record<string, string> = {
        'Invalid credentials': 'Invalid email or password',
        'User not found': 'Invalid email or password',
        'Invalid email address': 'Please enter a valid email address',
      };
      setError(errorMap[raw] || raw || 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slack-surface px-4">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mb-6 flex items-center justify-center">
          <Wordmark />
        </div>
        <h1 className="font-heading text-[34px] font-semibold tracking-tight text-slack-primary">Sign in to {APP_NAME}</h1>
        <p className="mt-2 text-gray-600">
          We suggest using the <strong>email address you use at work.</strong>
        </p>
      </div>

      {/* Login Form */}
      <div className="w-full max-w-[420px] rounded-[28px] surface-card p-8">

        {googleEnabled && (
          <>
            <a
              href="/auth/google"
              data-testid="google-signin"
              className="flex h-11 w-full items-center justify-center gap-3 rounded-xl surface-card-sm text-[15px] font-medium text-slack-primary transition-shadow active:bg-slack-active-tab"
            >
              <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </a>
            <div className="my-5 flex items-center gap-3 text-[12px] text-slack-hint">
              <span className="h-px flex-1 bg-slack-border" />
              or sign in with email
              <span className="h-px flex-1 bg-slack-border" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}
          <div>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@work-email.com"
              required
              className="h-11"
            />
          </div>
          <div>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="h-11"
            />
          </div>
          <Button
            type="submit"
            disabled={isLoading}
            className="h-11 w-full bg-slack-purple hover:bg-slack-sidebar text-white font-medium"
          >
            {isLoading ? 'Signing in...' : 'Sign in with Email'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
          New to {APP_NAME}?{' '}
          <Link to="/register" className="text-slack-link hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
