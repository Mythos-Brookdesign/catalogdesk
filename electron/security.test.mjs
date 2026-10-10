import { describe, expect, it } from 'vitest'
import security from './security.cjs'

describe('desktop boundary', () => {
  it('only allows local application assets', () => {
    expect(
      security.assetPath('catalog://app/assets/index.js', '/app/dist'),
    ).toBe('/app/dist/assets/index.js')
    for (const url of [
      'https://app/assets/index.js',
      'catalog://evil/index.html',
      'catalog://app/%2e%2e%2fsecret.txt',
    ])
      expect(() => security.assetPath(url, '/app/dist')).toThrow()
  })
  it('validates filenames, payload shape and message sender', () => {
    expect(
      security.saveSchema.safeParse({ filename: '../secrets.csv', content: '' })
        .success,
    ).toBe(false)
    expect(
      security.saveSchema.safeParse({
        filename: 'products.csv',
        content: 'a,b',
        path: '/tmp',
      }).success,
    ).toBe(false)
    expect(
      security.saveSchema.safeParse({
        filename: 'products.csv',
        content: 'a,b',
      }).success,
    ).toBe(true)
    const frame = { url: 'catalog://app/index.html' }
    const contents = { mainFrame: frame }
    const window = { isDestroyed: () => false, webContents: contents }
    expect(
      security.trustedSender(
        { sender: contents, senderFrame: frame },
        window,
        frame.url,
      ),
    ).toBe(true)
    expect(
      security.trustedSender(
        { sender: contents, senderFrame: { url: frame.url } },
        window,
        frame.url,
      ),
    ).toBe(false)
  })
})
