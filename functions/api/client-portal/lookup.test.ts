import { onRequestPost } from './lookup';

describe('client-portal/lookup', () => {
  it('should return generic success message when email is not found', async () => {
    const request = new Request('http://localhost/api/client-portal/lookup', {
      method: 'POST',
      body: JSON.stringify({ email: 'nonexistent@example.com', turnstileToken: 'test-token' }),
    });

    // Mock dependencies
    const env = { 
      ENVIRONMENT: 'test',
      TURNSTILE_SECRET: 'test-secret',
      DB: { prepare: () => ({ bind: () => ({ first: () => null }) }) } 
    };

    // Need to mock turnstile or bypass it in tests somehow based on how others do it.
    // Assuming for now I'll just mock the verification call.
    const response = await onRequestPost({ request, env } as any);
    const data = await response.json();

    expect(data).toEqual({ success: true, message: 'If your email exists, we sent a link' });
  });
});

