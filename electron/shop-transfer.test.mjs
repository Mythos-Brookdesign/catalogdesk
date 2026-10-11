import { describe, expect, it, vi } from 'vitest'
import transfer from './shop-transfer.cjs'

const connection = {
  url: 'https://example.com/',
  consumerKey: 'ck_' + 'a'.repeat(40),
  consumerSecret: 'cs_' + 'b'.repeat(40),
}
const product = {
  id: 1,
  sku: 'A',
  type: 'simple',
  regular_price: '10.00',
  manage_stock: true,
  stock_quantity: 2,
}
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const input = {
  products: [{ sku: 'A', price: '12.50', stock: '4' }],
  fields: ['price', 'stock'],
}
function journal() {
  const events = []
  const database = vi.fn(async (operation, payload) => {
    if (operation === 'startTransfer')
      return {
        id: 'run',
        items: payload.entries.map((entry) => ({ ...entry, id: 'item' })),
      }
    if (operation === 'recordTransfer') events.push(payload)
    if (operation === 'transferDetail') return { events }
  })
  return { database, events }
}

describe('controlled WooCommerce transfer', () => {
  it('previews existing products and only writes approved price/stock fields after journaling', async () => {
    const plan = await transfer.previewTransfer(connection, input, async () =>
      response([product]),
    )
    expect(plan.entries[0]).toMatchObject({
      status: 'ready',
      desired: { regular_price: '12.50', stock_quantity: 4 },
    })
    const { database, events } = journal()
    let wrote = false
    const fetcher = vi.fn(async (_url, options) => {
      if (options.method === 'PUT') {
        expect(events.at(-1).status).toBe('sending')
        expect(JSON.parse(options.body)).toEqual({
          regular_price: '12.50',
          stock_quantity: 4,
        })
        wrote = true
      }
      return response(
        wrote
          ? { ...product, regular_price: '12.50', stock_quantity: 4 }
          : product,
      )
    })
    await transfer.executeTransfer(connection, plan, ['A'], fetcher, database)
    expect(events.at(-1).status).toBe('success')
    expect(
      fetcher.mock.calls.filter(([, options]) => options.method === 'PUT'),
    ).toHaveLength(1)
  })
  it('blocks conflicts and unsupported, missing or unchanged products', async () => {
    const plan = await transfer.previewTransfer(connection, input, async () =>
      response([product]),
    )
    const { database, events } = journal()
    const fetcher = vi.fn(async () =>
      response({ ...product, regular_price: '11.00' }),
    )
    await transfer.executeTransfer(connection, plan, ['A'], fetcher, database)
    expect(events[0].status).toBe('conflict')
    expect(
      fetcher.mock.calls.every(([, options]) => options.method === 'GET'),
    ).toBe(true)
    for (const found of [
      [],
      [{ ...product, type: 'variable' }],
      [{ ...product, manage_stock: false }],
    ]) {
      expect(
        (
          await transfer.previewTransfer(connection, input, async () =>
            response(found),
          )
        ).entries[0].status,
      ).toBe('blocked')
    }
    expect(
      (
        await transfer.previewTransfer(
          connection,
          { ...input, products: [{ sku: 'A', price: '10.00', stock: '2' }] },
          async () => response([product]),
        )
      ).entries[0].status,
    ).toBe('unchanged')
  })
  it('reconciles an ambiguous write with GET, never retries and records uncertainty', async () => {
    const plan = await transfer.previewTransfer(connection, input, async () =>
      response([product]),
    )
    for (const applied of [true, false]) {
      const { database, events } = journal()
      let attempts = 0
      const fetcher = async (_url, options) => {
        if (options.method === 'PUT') {
          attempts++
          throw new Error(connection.consumerSecret)
        }
        return response(
          attempts && applied
            ? { ...product, regular_price: '12.50', stock_quantity: 4 }
            : product,
        )
      }
      await transfer.executeTransfer(connection, plan, ['A'], fetcher, database)
      expect(attempts).toBe(1)
      expect(events.at(-1).status).toBe(applied ? 'success' : 'unknown')
      expect(JSON.stringify(events)).not.toContain(connection.consumerSecret)
    }
  })
  it('requires valid selection, aborts before writing and refuses writes if journal fails', async () => {
    const plan = await transfer.previewTransfer(connection, input, async () =>
      response([product]),
    )
    const fetcher = vi.fn()
    await expect(
      transfer.executeTransfer(connection, plan, ['X'], fetcher, vi.fn()),
    ).rejects.toThrow('freigegebene')
    const controller = new AbortController()
    controller.abort()
    const { database, events } = journal()
    await transfer.executeTransfer(connection, plan, ['A'], fetcher, database, {
      signal: controller.signal,
    })
    expect(events.at(-1).status).toBe('cancelled')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(
      transfer.executeTransfer(connection, plan, ['A'], fetcher, async () => {
        throw new Error('disk full')
      }),
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('records write permission failures and allows read-only reconciliation without rewriting', async () => {
    const plan = await transfer.previewTransfer(connection, input, async () =>
      response([product]),
    )
    const { database, events } = journal()
    const fetcher = vi.fn(async (_url, options) =>
      response(product, options.method === 'PUT' ? 403 : 200),
    )
    await transfer.executeTransfer(connection, plan, ['A'], fetcher, database)
    expect(events.at(-1)).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Lesen/Schreiben'),
    })
    const run = {
      id: 'run',
      url: plan.url,
      items: [{ ...plan.entries[0], id: 'item', status: 'unknown' }],
    }
    const read = vi.fn(async () =>
      response({ ...product, regular_price: '12.50', stock_quantity: 4 }),
    )
    await transfer.verifyTransfer(connection, run, read, database)
    expect(events.at(-1).status).toBe('success')
    expect(
      read.mock.calls.every(([, options]) => options.method === 'GET'),
    ).toBe(true)
  })
})
