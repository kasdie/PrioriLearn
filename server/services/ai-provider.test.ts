import { describe, expect, it } from 'vitest'
import { buildDocumentExtractionContent } from './ai-provider.js'

describe('OpenAI document input', () => {
  it.each([
    ['schedule.png', 'image/png'],
    ['assignment.jpg', 'image/jpeg'],
  ])('sends %s as a private high-detail image input', (filename, mimeType) => {
    const image = Buffer.from([0x00, 0x01, 0x02, 0x03])
    const content = buildDocumentExtractionContent({ filename, mimeType, content: image })

    expect(content).toEqual([
      {
        type: 'input_image',
        detail: 'high',
        image_url: `data:${mimeType};base64,${image.toString('base64')}`,
      },
      {
        type: 'input_text',
        text: expect.stringContaining('Read only visible content'),
      },
    ])
  })
})
