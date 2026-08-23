import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminClients from './AdminClients';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  searchAdminClients: vi.fn(),
  updateAdminDriveFolder: vi.fn(),
  sendAdminClientEmail: vi.fn(),
}));

vi.mock('../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({ isAuthed: true, loading: false }),
}));

test('AdminClients renders search input and filters', () => {
  render(<AdminClients />);
  expect(screen.getByPlaceholderText('Email, first or last name')).toBeInTheDocument();
  expect(screen.getByLabelText('From')).toBeInTheDocument();
  expect(screen.getByLabelText('To')).toBeInTheDocument();
});

test('AdminClients calls search with dates', async () => {
  (api.searchAdminClients as any).mockResolvedValue([]);
  render(<AdminClients />);
  
  fireEvent.change(screen.getByPlaceholderText('Email, first or last name'), { target: { value: 'test' } });
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2023-01-01' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2023-01-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  await waitFor(() => {
    expect(api.searchAdminClients).toHaveBeenCalledWith('test', { startDate: '2023-01-01', endDate: '2023-01-31' });
  });
});

