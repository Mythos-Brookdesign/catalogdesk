import { describe, expect, it, vi } from 'vitest'
import discovery from './shop-discovery.cjs'

const connection = {
  url: 'https://catalogdesk.local/shop/',
  consumerKey: 'ck_' + 'a'.repeat(40),
  consumerSecret: 'cs_' + 'b'.repeat(40),
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const types = {
  product: {
    name: 'Products',
    rest_base: 'products',
    rest_namespace: 'wc/v3',
    public: true,
    taxonomies: [
      'product_cat',
      'product_brand',
      'delivery_time',
      'product_unit',
      'manufacturer',
      'price_evidence',
    ],
  },
  manufacturer: {
    name: 'Manufacturers',
    rest_base: 'manufacturers',
    rest_namespace: 'wp/v2',
    public: true,
    taxonomies: ['product_brand'],
  },
  hidden_record: {
    name: 'Internal records',
    rest_base: null,
    rest_namespace: null,
    public: false,
    taxonomies: [],
  },
}

const taxonomies = {
  product_cat: {
    name: 'Categories',
    rest_base: 'product_cat',
    rest_namespace: 'wp/v2',
    types: ['product'],
  },
  product_brand: {
    name: 'Brands',
    rest_base: 'product_brand',
    rest_namespace: 'wp/v2',
    types: ['product'],
  },
}

describe('read-only WordPress REST discovery', () => {
  it('lists REST namespaces, post types and product-related taxonomies', async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/wp-json/'))
        return json({ namespaces: ['wp/v2', 'wc/v3', 'brand-plugin/v1'] })
      if (url.pathname.endsWith('/wp/v2/types')) return json(types)
      if (url.pathname.endsWith('/wp/v2/taxonomies')) return json(taxonomies)
      if (url.pathname.endsWith('/wc/v3/products'))
        return json([
          { id: 10, type: 'variable', attributes: [], categories: [] },
        ])
      if (url.pathname.endsWith('/wc/v3/products/categories'))
        return json([{ id: 2, name: 'Papeterie', slug: 'papeterie' }])
      if (url.pathname.endsWith('/wc/v3/products/tags'))
        return json([{ id: 3, name: 'Sale', slug: 'sale' }])
      if (url.pathname.endsWith('/wc/v3/products/attributes'))
        return json([
          { id: 4, name: 'Groesse', slug: 'pa_groesse', type: 'select' },
        ])
      return json({}, 404)
    })

    const result = await discovery.discoverShopRest(connection, fetcher)

    expect(result).toMatchObject({
      ok: true,
      indexStatus: 'available',
      namespaces: ['wp/v2', 'wc/v3', 'brand-plugin/v1'],
      postTypesStatus: 'available',
      taxonomiesStatus: 'available',
      productApiStatus: 'available',
      productTypes: ['variable'],
      commerceResources: {
        categories: 'available',
        tags: 'available',
        attributes: 'available',
      },
      productAttributes: [
        { id: 4, name: 'Groesse', slug: 'pa_groesse', type: 'select' },
      ],
    })
    expect(result.postTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'product',
          relation: 'woocommerce-core',
        }),
        expect.objectContaining({
          slug: 'manufacturer',
          relation: 'shares-product-taxonomy',
        }),
        expect.objectContaining({
          slug: 'hidden_record',
          relation: 'unclassified',
        }),
      ]),
    )
    expect(
      result.taxonomies.find((taxonomy) => taxonomy.slug === 'product_brand'),
    ).toMatchObject({ attachedToProducts: true, restIndexed: true })
    expect(result.taxonomies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'delivery_time',
          attachedToProducts: true,
          restIndexed: false,
        }),
        expect.objectContaining({
          slug: 'product_unit',
          attachedToProducts: true,
          restIndexed: false,
        }),
        expect.objectContaining({
          slug: 'manufacturer',
          attachedToProducts: true,
          restIndexed: false,
        }),
        expect.objectContaining({
          slug: 'price_evidence',
          attachedToProducts: true,
          restIndexed: false,
        }),
      ]),
    )

    for (const [input, options] of fetcher.mock.calls) {
      const url = new URL(input)
      expect(url.origin).toBe('https://catalogdesk.local')
      expect(url.pathname).toMatch(/^\/shop\/wp-json\//)
      expect(options.method).toBe('GET')
      expect(options.redirect).toBe('error')
      expect(options.credentials).toBe('omit')
      expect(options.headers.Authorization).toBe(
        `Basic ${Buffer.from(`${connection.consumerKey}:${connection.consumerSecret}`).toString('base64')}`,
      )
      expect(url.searchParams.get('_fields') ?? '').not.toContain('meta_data')
    }
  })

  it('reports endpoint access limits without hiding the WooCommerce API result', async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/wp/v2/types'))
        return json({ code: 'rest_forbidden' }, 403)
      if (url.pathname.endsWith('/wp/v2/taxonomies')) return json({}, 404)
      if (url.pathname.endsWith('/wc/v3/products'))
        return json([
          { id: 10, type: 'simple', attributes: [], categories: [] },
        ])
      if (url.pathname.endsWith('/wc/v3/products/categories')) return json([])
      if (url.pathname.endsWith('/wc/v3/products/tags')) return json([])
      if (url.pathname.endsWith('/wc/v3/products/attributes')) return json([])
      return json({ namespaces: ['wc/v3'] })
    })

    const result = await discovery.discoverShopRest(connection, fetcher)

    expect(result).toMatchObject({
      ok: true,
      postTypesStatus: 'denied',
      taxonomiesStatus: 'unavailable',
      productApiStatus: 'available',
      postTypes: [],
      taxonomies: [],
      productTypes: ['simple'],
    })
    expect(JSON.stringify(result)).not.toContain(connection.consumerSecret)
  })

  it('falls back to public WordPress metadata and marks the result partial', async () => {
    const fetcher = vi.fn(async (input) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/wp/v2/types')) {
        if (url.searchParams.get('context') === 'edit')
          return json({ code: 'rest_forbidden' }, 403)
        return json({ manufacturer: { name: 'Manufacturers', taxonomies: [] } })
      }
      if (url.pathname.endsWith('/wp/v2/taxonomies')) {
        if (url.searchParams.get('context') === 'edit')
          return json({ code: 'rest_forbidden' }, 403)
        return json({ brand: { name: 'Brands', types: ['product'] } })
      }
      if (url.pathname.endsWith('/wc/v3/products')) return json([])
      if (url.pathname.endsWith('/wc/v3/products/categories')) return json([])
      if (url.pathname.endsWith('/wc/v3/products/tags')) return json([])
      if (url.pathname.endsWith('/wc/v3/products/attributes')) return json([])
      return json({ namespaces: ['wp/v2', 'wc/v3'] })
    })

    const result = await discovery.discoverShopRest(connection, fetcher)

    expect(result).toMatchObject({
      ok: true,
      postTypesStatus: 'partial',
      taxonomiesStatus: 'partial',
    })
    expect(result.postTypes).toEqual([
      expect.objectContaining({ slug: 'manufacturer', name: 'Manufacturers' }),
    ])
    expect(result.taxonomies).toEqual([
      expect.objectContaining({ slug: 'brand', attachedToProducts: true }),
    ])
  })

  it('rejects invalid connections before making any request', async () => {
    const fetcher = vi.fn()
    const result = await discovery.discoverShopRest(
      { ...connection, url: 'http://catalogdesk.local' },
      fetcher,
    )

    expect(result).toMatchObject({ ok: false })
    expect(fetcher).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(connection.consumerSecret)
  })
})
