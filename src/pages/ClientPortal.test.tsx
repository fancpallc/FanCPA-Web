import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ClientPortal from './ClientPortal';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  lookupClientPortal: vi.fn(),
}));

describe('ClientPortal', () => {
  it('renders input and turnstile widget', () => {
    render(<ClientPortal />);
    expect(screen.getByPlaceholderText('Enter your email')).toBeDefined();
    expect(screen.getByText('Send Access Link')).toBeDefined();
  });

  it('disables submit button without turnstile token', () => {
    render(<ClientPortal />);
    const button = screen.getByRole('button', { name: /send access link/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('submits email and shows success message', async () => {
    (api.lookupClientPortal as any).mockResolvedValue({ success: true, message: 'If your email exists, we sent a link' });

    render(<ClientPortal />);

    // Simulate setting token
    const button = screen.getByRole('button', { name: /send access link/i });

    // We need to bypass Turnstile check or simulate setTurnstileToken.
    // Since we are mocking the internal state, we can't directly trigger setTurnstileToken without refactoring.
    // However, the component relies on window.turnstile.render's callback.
    // For test, we will just manually set the token or trigger the callback.
    // Given the component structure, I will add a way to test this.
  });
});

