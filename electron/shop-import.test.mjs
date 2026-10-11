import { describe, expect, it, vi } from 'vitest'
import importer from './shop-import.cjs'

const connection = {
  url: 'https://catalogdesk.local',
  consumerKey: 'ck_' + 'a'.repeat(40),
  consumerSecret: 'cs_' + 'b'.repeat(40),
}
const product = (id, extra = {}) => ({
  id,
  type: 'simple',
  sku: `NL-${id}`,
  name: 'Notebook',
  regular_price: '12.50',
  description: '<p>Text</p>',
  manage_stock: true,
  stock_quantity: 0,
  categories: [{ id: 1, name: 'Home, Office' }],
  ...extra,
})
const response = (data, total = data.length, pages = Math.ceil(total / 100)) =>
  new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json',
      'x-wp-total': String(total),
      'x-wp-totalpages': String(pages),
    },
  })

describe('WooCommerce product import', () => {
  it('loads all pages read-only, maps values and reports skipped types', async () => {
    const first = Array.from({ length: 100 }, (_, index) => product(index + 1))
    first[1] = { id: 2, type: 'variable' }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(first, 102))
      .mockResolvedValueOnce(
        response(
          [
            product(101, { manage_stock: false, stock_quantity: null }),
            product(102),
          ],
          102,
        ),
      )
    const progress = vi.fn()
    const result = await importer.importShopProducts(connection, fetcher, {
      onProgress: progress,
    })
    expect(result).toMatchObject({
      ok: true,
      imported: 101,
      total: 102,
      skipped: [{ type: 'variable', count: 1 }],
    })
    expect(result.dataset.rows[0]).toEqual([
      'NL-1',
      'Notebook',
      '12.50',
      '0',
      'Home\\, Office',
      '<p>Text</p>',
    ])
    expect(result.dataset.rows[99][3]).toBe('')
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('page')).toBe('2')
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).not.toContain(connection.consumerKey)
      expect(options).toMatchObject({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
      })
    }
    expect(progress).toHaveBeenLastCalledWith({
      loaded: 102,
      total: 102,
      page: 2,
      pages: 2,
    })
  })
  it('does not return partial catalogs on changing totals, missing pages or duplicate IDs', async () => {
    const first = Array.from({ length: 100 }, (_, index) => product(index + 1))
    for (const second of [
      response([product(101)], 103),
      response([], 101),
      response([product(1)], 101),
    ]) {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(first, 101))
        .mockResolvedValueOnce(second)
      expect(
        await importer.importShopProducts(connection, fetcher),
      ).toMatchObject({ ok: false })
    }
  })
  it('leaves the old catalog intact for empty or unsupported shops', async () => {
    expect(
      await importer.importShopProducts(connection, async () => response([])),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('keine lesbaren'),
    })
    expect(
      await importer.importShopProducts(connection, async () =>
        response([{ id: 1, type: 'variable' }]),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('Keine einfachen'),
    })
  })
  it('rejects insecure inputs, malformed payloads and oversized catalogs without exposing keys', async () => {
    const fetcher = vi.fn()
    expect(
      (
        await importer.importShopProducts(
          { ...connection, url: 'http://catalogdesk.local' },
          fetcher,
        )
      ).ok,
    ).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    for (const invalid of [
      response([product(1, { regular_price: 12.5 })]),
      response([], 50_001),
      new Response(connection.consumerSecret, { status: 403 }),
    ]) {
      const result = await importer.importShopProducts(
        connection,
        async () => invalid,
      )
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(connection.consumerSecret)
    }
    expect(
      JSON.stringify(
        await importer.importShopProducts(connection, async () => {
          throw new Error(connection.consumerSecret)
        }),
      ),
    ).not.toContain(connection.consumerSecret)
    expect(
      JSON.stringify(
        await importer.importShopProducts(connection, async () => {
          throw new Error('Der Shop ' + connection.consumerSecret)
        }),
      ),
    ).not.toContain(connection.consumerSecret)
  })
  it('supports cancellation and page timeouts', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn()
    expect(
      await importer.importShopProducts(connection, fetcher, {
        signal: controller.signal,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('abgebrochen'),
    })
    expect(fetcher).not.toHaveBeenCalled()
    vi.useFakeTimers()
    try {
      const pending = importer.importShopProducts(
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
