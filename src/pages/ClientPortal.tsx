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
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    const checkTurnstile = setInterval(() => {
      if (window.turnstile) {
        clearInterval(checkTurnstile);
      window.turnstile.render('#client-portal-turnstile-widget', {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
          'error-callback': () => {
            console.error('Turnstile error');
            setTurnstileToken(null);
          },
      });
    }
    }, 500);

    return () => {
      clearInterval(checkTurnstile);
      const widget = document.getElementById('client-portal-turnstile-widget');
      if (widget) widget.innerHTML = '';
      document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]')?.remove();
  };
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
    <div className="max-w-md mx-auto p-6 bg-white shadow rounded-lg mt-10">
      <h1 className="text-2xl font-bold mb-4 text-gray-900">Client Portal Access</h1>
      {status === 'success' ? (
        <p className="text-green-600">If an account with that email exists, we have sent a link to your inbox.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="w-full p-3 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            required
          />
          <div id="client-portal-turnstile-widget" className="min-h-[65px]" />
          <button
            type="submit"
            disabled={!turnstileToken || status === 'loading'}
            className="w-full p-3 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 disabled:bg-gray-400"
          >
            {status === 'loading' ? 'Processing...' : 'Send Access Link'}
          </button>
        </form>
      )}
    </div>
  );
}

