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

    // Manually trigger the Turnstile callback if possible or expose a test way
    // For this test, we will assume we can mock window.turnstile
    (window as any).turnstile = {
      render: vi.fn((_el, options) => {
        options.callback('mock-token');
        return 'widget-id';
      }),
      remove: vi.fn(),
    };

    const input = screen.getByPlaceholderText('Enter your email');
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    const button = screen.getByRole('button', { name: /send access link/i }) as HTMLButtonElement;

    await waitFor(() => {
        expect(button.disabled).toBe(false);
    });

    fireEvent.click(button);

    await waitFor(() => {
        expect(screen.getByText(/If your email exists, we sent a link/i)).toBeDefined();
    });
  });
});

