import { describe, expect, it, vi } from 'vitest'
import shop from './shop.cjs'

const connection = {
  url: 'https://catalogdesk.local/',
  consumerKey: 'ck_' + 'a'.repeat(40),
  consumerSecret: 'cs_' + 'b'.repeat(40),
}
const response = (data = [{ id: 1, sku: 'NL-1001' }], total = '20') =>
  new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'x-wp-total': total },
  })

describe('read-only shop connection', () => {
  it('validates HTTPS and credentials before any request', async () => {
    for (const url of [
      'http://catalogdesk.local',
      'file:///tmp',
      'https://user:password@example.com',
      'https://example.com/?key=secret',
      'https://example.com/#secret',
    ]) {
      const fetcher = vi.fn()
      expect(
        (await shop.testConnection({ ...connection, url }, fetcher)).ok,
      ).toBe(false)
      expect(fetcher).not.toHaveBeenCalled()
    }
    expect(
      shop.connectionSchema.safeParse({ ...connection, consumerKey: 'bad' })
        .success,
    ).toBe(false)
    expect(
      shop.connectionSchema.safeParse({ ...connection, extra: 'value' })
        .success,
    ).toBe(false)
  })
  it('only sends a GET with header authentication and blocks redirects', async () => {
    const fetcher = vi.fn().mockResolvedValue(response())
    const result = await shop.testConnection(
      { ...connection, url: 'https://example.com/wordpress/' },
      fetcher,
    )
    expect(result).toMatchObject({
      ok: true,
      productCount: 20,
      url: 'https://example.com/wordpress/',
    })
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe(
      'https://example.com/wordpress/wp-json/wc/v3/products?per_page=1&page=1&status=any&_fields=id%2Csku',
    )
    expect(url).not.toContain(connection.consumerKey)
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    })
    expect(options.headers.Authorization).toBe(
      'Basic ' +
        Buffer.from(
          `${connection.consumerKey}:${connection.consumerSecret}`,
        ).toString('base64'),
    )
    expect(JSON.stringify(result)).not.toContain(connection.consumerSecret)
  })
  it('accepts an empty shop', async () => {
    expect(
      await shop.testConnection(connection, async () => response([], '0')),
    ).toMatchObject({ ok: true, productCount: 0 })
  })
  it('returns safe errors without forwarding server or network messages', async () => {
    for (const status of [401, 403, 404, 500]) {
      const result = await shop.testConnection(
        connection,
        async () => new Response(connection.consumerSecret, { status }),
      )
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(connection.consumerSecret)
    }
    expect(
      (
        await shop.testConnection(connection, async () => {
          throw new Error(connection.consumerSecret)
        })
      ).error,
    ).not.toContain(connection.consumerSecret)
    for (const invalid of [
      new Response('<html>Login</html>'),
      response({ error: 'bad' }),
      response([], 'bad'),
      response([{ id: 1, sku: 'A' }], '0'),
      response([{ id: 1, sku: 'x'.repeat(70_000) }]),
    ]) {
      expect(
        (await shop.testConnection(connection, async () => invalid)).ok,
      ).toBe(false)
    }
  })
  it('aborts stalled requests after 15 seconds', async () => {
    vi.useFakeTimers()
    try {
      const pending = shop.testConnection(
        connection,
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      )
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await pending).toMatchObject({
        ok: false,
        error: expect.stringContaining('Zeitlimit'),
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
