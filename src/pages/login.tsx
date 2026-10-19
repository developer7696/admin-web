import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { signInWithGoogle } from '@/auth/admin-auth';
import { BrandMark } from '@/components/common/brand-mark';
import { Button } from '@/components/ui/button';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/// Google is the only way in. The API refuses admin calls from a password
/// session (`strong_sign_in_required`), so a password form here would only be a
/// way to sign in and then be told no.
export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      // On success the auth listener swaps this page out; no navigation here.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[#5B21D6] shadow-lg shadow-primary/20">
            <BrandMark className="h-11" />
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight">Aarambh Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">Dashboard</p>
        </div>

        <div className="mt-12">
          <h2 className="text-lg font-semibold">Sign In</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the Google account you were given access with. Turn on 2-Step Verification for it
            in your Google account settings.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={loading}
            onClick={() => void run()}
          >
            {loading ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
            Sign in with Google
          </Button>
        </div>
      </div>
    </div>
  );
}
