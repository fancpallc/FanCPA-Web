import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImageUploader } from './ImageUploader'

const mockResizeImage = vi.fn()
vi.mock('../../lib/imageResize', async () => {
  const actual = await vi.importActual<any>('../../lib/imageResize')
  return {
    ...actual,
    resizeImage: (...args: any[]) => mockResizeImage(...args),
    isImageFile: (file: File) => file.type.startsWith('image/'),
    MAX_FILE_SIZE: 1_048_576,
    MAX_DIMENSION: 1200,
  }
})

function makeFile(name: string, size: number, type: string): File {
  const buf = new Uint8Array(size)
  return new File([buf], name, { type })
}

describe('ImageUploader — PNG if ≤1MB else WebP within 1MB', () => {
  const mockFetch = vi.fn()
  const originalFetch = global.fetch
  const originalCreateObjectURL = (global as any).URL?.createObjectURL
  const originalRevokeObjectURL = (global as any).URL?.revokeObjectURL

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch as any
    // Mock URL.createObjectURL for jsdom
    if (!(global as any).URL) (global as any).URL = {}
    ;(global as any).URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    ;(global as any).URL.revokeObjectURL = vi.fn()
    mockResizeImage.mockImplementation(async (file: File) => {
      // Simulate PNG if ≤1MB else WebP
      const isSmall = file.size <= 600_000
      const format = isSmall ? 'png' : 'webp'
      const size = isSmall ? 500_000 : 350_000
      const blob = new Blob([new Uint8Array(size)], { type: `image/${format}` })
      return {
        blob,
        format,
        width: 1200,
        height: 900,
        originalSize: file.size,
        finalSize: size,
        quality: format === 'webp' ? 0.8 : undefined,
      }
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (originalCreateObjectURL) (global as any).URL.createObjectURL = originalCreateObjectURL
    if (originalRevokeObjectURL) (global as any).URL.revokeObjectURL = originalRevokeObjectURL
  })

  it('renders file input', () => {
    render(<ImageUploader onUploadComplete={vi.fn()} />)
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument()
    // Free tier info removed per user request #2 — no PNG→WebP spec, no 10GB math, no "No image" box
    expect(screen.queryByText(/1MB max|max 1200px|10GB/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No image/i)).not.toBeInTheDocument()
  })

  it('gives the file input the requested id so an outside element can trigger it', () => {
    render(<ImageUploader inputId="upload-item1" onUploadComplete={vi.fn()} />)
    const input = document.getElementById('upload-item1')
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect((input as HTMLInputElement).type).toBe('file')
  })

  it('opens the file picker when the upload button is clicked', () => {
    render(<ImageUploader onUploadComplete={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    // display:none inputs do not open the picker in Safari — must stay clickable
    expect(input.className).not.toContain('hidden')
    const clickSpy = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: /upload image/i }))
    expect(clickSpy).toHaveBeenCalled()
  })

  it('hero variant renders one clickable preview and no second uploader', () => {
    render(<ImageUploader variant="hero" currentImageUrl="/api/images/portfolio/hero.png" onUploadComplete={vi.fn()} />)
    const input = document.querySelectorAll('input[type="file"]')
    expect(input.length).toBe(1)
    const target = screen.getByRole('button', { name: /replace hero image/i })
    const clickSpy = vi.spyOn(input[0] as HTMLInputElement, 'click')
    fireEvent.click(target)
    expect(clickSpy).toHaveBeenCalled()
  })

  it('rejects non-image file type', async () => {
    const onError = vi.fn()
    render(<ImageUploader onUploadComplete={vi.fn()} onError={onError} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const txtFile = makeFile('doc.txt', 1000, 'text/plain')
    fireEvent.change(input, { target: { files: [txtFile] } })
    await waitFor(() => expect(screen.getByText(/isn't an image/i)).toBeInTheDocument())
    expect(onError).toHaveBeenCalled()
  })

  // An 8x8 favicon uploaded into the hero slot was accepted silently, and `object-cover`
  // blew its 64 pixels up to roughly 720x540 — the page's first impression was a solid
  // colour block that looked like a rendering failure.
  const uploadTiny = async (variant: 'card' | 'hero', width: number) => {
    mockResizeImage.mockResolvedValue({
      blob: new Blob([new Uint8Array(89)], { type: 'image/png' }),
      format: 'png',
      width,
      height: width,
      originalSize: 89,
      finalSize: 89,
    })
    const onError = vi.fn()
    render(<ImageUploader variant={variant} onUploadComplete={vi.fn()} onError={onError} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('favicon.png', 89, 'image/png')] } })
    return onError
  }

  it('refuses an image too small for the hero slot instead of publishing a colour block', async () => {
    const onError = await uploadTiny('hero', 8)
    await waitFor(() => expect(screen.getByText(/only 8px wide/i)).toBeInTheDocument())
    expect(screen.getByText(/at least 640px wide/i)).toBeInTheDocument()
    expect(onError).toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('holds card images to a lower bar than hero images', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ key: 'portfolio/a.png', url: '/api/images/portfolio/a.png', size: 89, format: 'png' }) } as any)
    const onError = await uploadTiny('card', 400)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(onError).not.toHaveBeenCalled()
  })

  it('rejects a 300px image in a card slot', async () => {
    await uploadTiny('card', 300)
    await waitFor(() => expect(screen.getByText(/at least 320px wide/i)).toBeInTheDocument())
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('resizes on client and uploads PNG when PNG ≤1MB (lossless)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ key: 'portfolio/abc.png', url: '/api/images/portfolio/abc.png', size: 500_000, format: 'png' }),
    } as any)

    const onComplete = vi.fn()
    render(<ImageUploader onUploadComplete={onComplete} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const smallFile = makeFile('profile.png', 500_000, 'image/png')
    fireEvent.change(input, { target: { files: [smallFile] } })

    await waitFor(() => expect(mockResizeImage).toHaveBeenCalled())
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/admin/upload-image', expect.anything()))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ format: 'png' })))
  })

  it('resizes and uploads WebP fallback when PNG >1MB to compress within 1MB', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ key: 'portfolio/photo.webp', url: '/api/images/portfolio/photo.webp', size: 350_000, format: 'webp' }),
    } as any)

    const onComplete = vi.fn()
    render(<ImageUploader onUploadComplete={onComplete} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const bigFile = makeFile('big.png', 2_000_000, 'image/png')
    // Our mock will return WebP for big file (>600KB)
    mockResizeImage.mockImplementationOnce(async () => ({
      blob: new Blob([new Uint8Array(350_000)], { type: 'image/webp' }),
      format: 'webp',
      width: 1200,
      height: 900,
      originalSize: 2_000_000,
      finalSize: 350_000,
      quality: 0.8,
    }))

    fireEvent.change(input, { target: { files: [bigFile] } })
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ format: 'webp', size: 350_000 })))
  })

  it('sends oldKey for replace-on-update to stay under 10GB free tier', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ key: 'portfolio/new.png', url: '/api/images/portfolio/new.png', size: 300_000, format: 'png' }),
    } as any)

    render(<ImageUploader oldKey="portfolio/old.png" onUploadComplete={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('new.png', 300_000, 'image/png')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    const fetchCall = mockFetch.mock.calls[0]
    const fetchOpts = fetchCall[1] as any
    const formData = fetchOpts.body as FormData
    expect(formData.get('oldKey')).toBe('portfolio/old.png')
  })

  it('handles upload error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'File too large >1MB' }),
    } as any)

    render(<ImageUploader onUploadComplete={vi.fn()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('big.png', 500_000, 'image/png')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText(/File too large/i)).toBeInTheDocument())
  })

  it('shows exactly one upload control (no duplicate buttons)', async () => {
    render(<ImageUploader currentImageUrl="/api/images/portfolio/a.png" onUploadComplete={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1)
  })
})
