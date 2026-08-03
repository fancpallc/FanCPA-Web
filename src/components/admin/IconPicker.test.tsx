import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconPicker } from './IconPicker'

describe('IconPicker', () => {
  it('opens the choices from the tile and saves the one picked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<IconPicker icon="🎯" onSave={onSave} label="Brand Strategy" />)

    const tile = screen.getByRole('button', { name: 'Change the icon for Brand Strategy' })
    expect(tile).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(tile)
    await userEvent.click(screen.getByRole('button', { name: 'Use 🚀 for Brand Strategy' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('🚀'))
    expect(screen.getByRole('button', { name: 'Change the icon for Brand Strategy' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('accepts an icon the owner types themselves', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<IconPicker icon="🎯" onSave={onSave} label="Brand Strategy" />)

    await userEvent.click(screen.getByRole('button', { name: 'Change the icon for Brand Strategy' }))
    await userEvent.type(screen.getByLabelText('Custom icon for Brand Strategy'), '🦊')
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('🦊'))
  })

  it('keeps the glyph inside the tile rather than beside an Edit hint', () => {
    // The old control was an EditableText, whose "✎ Edit" affordance made the trigger
    // wider than the 48px tile and pushed the glyph out of it.
    render(<IconPicker icon="🎯" onSave={vi.fn()} />)
    const tile = screen.getByRole('button', { name: /Change the icon/ })
    expect(tile.className).toContain('w-12')
    expect(tile.className).toContain('justify-center')
    expect(tile.textContent).toBe('🎯')
  })

  it('falls back to a glyph that fonts actually carry when no icon is set', () => {
    render(<IconPicker onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Change the icon/ }).textContent).toBe('✦')
  })
})
