import React, { useState } from 'react';
import { lookupClientPortal } from '../lib/api';

declare global {
  interface Window {
    turnstile: any;
  }
}

export default function ClientPortal() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  React.useEffect(() => {
    // @ts-ignore
    if (typeof window !== 'undefined' && window.turnstile) {
      // @ts-ignore
      window.turnstile.render('#client-portal-turnstile-widget', {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
      });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) return;

    setStatus('loading');
    try {
      await lookupClientPortal({ email, turnstileToken });
      setStatus('success');
    } catch (error) {
      console.error(error);
      setStatus('success'); // Generic success for anti-enumeration
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Client Portal Access</h1>
      {status === 'success' ? (
        <p className="text-green-600">If an account with that email exists, we have sent a link to your inbox.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="w-full p-2 border rounded"
            required
          />
          <div id="client-portal-turnstile-widget" />
          <button
            type="submit"
            disabled={!turnstileToken || status === 'loading'}
            className="w-full p-2 bg-blue-600 text-white rounded disabled:bg-gray-400"
          >
            {status === 'loading' ? 'Processing...' : 'Send Access Link'}
          </button>
        </form>
      )}
    </div>
  );
}

