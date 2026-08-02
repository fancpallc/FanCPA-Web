import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditableText } from './EditableText'

describe('EditableText — inline edit for admin', () => {
  it('renders display text', () => {
    render(<EditableText value="Hello" onSave={vi.fn()} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('renders placeholder when value empty', () => {
    render(<EditableText value="" onSave={vi.fn()} placeholder="Click to edit" />)
    expect(screen.getByText('Click to edit')).toBeInTheDocument()
  })

  it('click enters edit mode with input (double-click removed per UIUX feedback to avoid double trigger)', async () => {
    render(<EditableText value="Hello" onSave={vi.fn()} />)
    const display = screen.getByText('Hello')
    fireEvent.click(display)
    expect(await screen.findByDisplayValue('Hello')).toBeInTheDocument()
  })

  it('click also enters edit mode', async () => {
    render(<EditableText value="World" onSave={vi.fn()} />)
    fireEvent.click(screen.getByText('World'))
    expect(await screen.findByDisplayValue('World')).toBeInTheDocument()
  })

  it('saves on Enter calls onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<EditableText value="Old" onSave={onSave} />)
    fireEvent.click(screen.getByText('Old'))
    const input = await screen.findByDisplayValue('Old')
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('New Title'))
  })

  it('cancels on Escape restores original', async () => {
    const onSave = vi.fn()
    render(<EditableText value="Original" onSave={onSave} />)
    fireEvent.click(screen.getByText('Original'))
    const input = await screen.findByDisplayValue('Original')
    fireEvent.change(input, { target: { value: 'Changed' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.getByText('Original')).toBeInTheDocument())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows saving state', async () => {
    const onSave = vi.fn().mockImplementation(() => new Promise<void>((res) => setTimeout(() => res(), 100)))
    render(<EditableText value="Test" onSave={onSave} />)
    fireEvent.click(screen.getByText('Test'))
    const input = await screen.findByDisplayValue('Test')
    fireEvent.change(input, { target: { value: 'Saving Test' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Queried by role: the field is a textarea, so its draft value ("Saving Test")
    // is also its text content and a plain text query matches two elements.
    expect(await screen.findByRole('button', { name: 'Save' })).toHaveTextContent('Saving…')
  })

  it('prevents empty save when required', async () => {
    const onSave = vi.fn()
    render(<EditableText value="Required Field" onSave={onSave} required />)
    fireEvent.click(screen.getByText('Required Field'))
    const input = await screen.findByDisplayValue('Required Field')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(/required/i)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('renders multiline textarea when multiline prop', async () => {
    render(<EditableText value="Line" onSave={vi.fn()} multiline />)
    fireEvent.click(screen.getByText('Line'))
    expect(await screen.findByDisplayValue('Line')).toBeInTheDocument()
    // textarea element
    expect(screen.getByDisplayValue('Line').tagName.toLowerCase()).toBe('textarea')
  })
})
