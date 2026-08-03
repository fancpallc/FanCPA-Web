import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RatingPicker } from './RatingPicker'

describe('RatingPicker', () => {
  it('saves the star the owner clicks', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<RatingPicker rating={5} onSave={onSave} label="Dana" />)

    await userEvent.click(screen.getByRole('button', { name: 'Rate Dana 3 out of 5 stars' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(3))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('shows five stars for a testimonial that has never been rated', () => {
    render(<RatingPicker rating={null} onSave={vi.fn()} />)
    expect(screen.getByText('5 of 5 stars')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rate this testimonial 5 out of 5/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('surfaces a failed save instead of pretending it worked', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('D1 write failed'))
    render(<RatingPicker rating={5} onSave={onSave} label="Dana" />)

    await userEvent.click(screen.getByRole('button', { name: 'Rate Dana 2 out of 5 stars' }))

    expect(await screen.findByText('D1 write failed')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not write when the owner re-picks the rating already stored', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<RatingPicker rating={4} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /Rate this testimonial 4 out of 5/ }))

    expect(onSave).not.toHaveBeenCalled()
  })
})
