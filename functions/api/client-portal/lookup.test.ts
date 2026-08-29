import { onRequestPost } from './lookup';

describe('client-portal/lookup', () => {
  it('should return generic success message when email is not found', async () => {
    const request = new Request('http://localhost/api/client-portal/lookup', {
      method: 'POST',
      body: JSON.stringify({ email: 'nonexistent@example.com', turnstileToken: 'test-token' }),
    });

    // Mock dependencies — use ENVIRONMENT=test to hit Turnstile stub bypass, or TURNSTILE_SECRET_KEY alias
    const env = {
      ENVIRONMENT: 'test',
      TURNSTILE_SECRET_KEY: 'test-secret',
      DB: {
        prepare: () => ({
          bind: () => ({
            first: () => null,
            all: () => Promise.resolve({ results: [] }),
          }),
        }),
      },
    } as any

    const response = await onRequestPost({ request, env } as any);
    const data = (await response.json()) as any;

    expect(data).toEqual({ success: true, message: 'If your email exists, we sent a link' });
  });
});
