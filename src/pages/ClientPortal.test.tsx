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
});

