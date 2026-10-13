const { z } = require('zod')
const { connectionSchema } = require('./shop.cjs')

const recordSchema = z.record(z.string(), z.unknown())
const namespaceListSchema = z.array(z.string().max(120)).max(500)
const productSampleSchema = z
  .array(
    z.object({
      id: z.number().int().positive(),
      type: z.string().max(80),
      attributes: z.array(z.unknown()).max(100),
      categories: z.array(z.unknown()).max(100),
    }),
  )
  .max(1)
const maxResponseBytes = 1024 * 1024
const timeoutMs = 20_000

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readJson(response) {
  if (
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json')
  )
    throw new Error('invalid-content-type')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('empty-response')
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxResponseBytes) {
      await reader.cancel()
      throw new Error('response-too-large')
    }
    chunks.push(Buffer.from(value))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function endpointStatus(status, detail = '') {
  return { status, ...(detail ? { detail } : {}) }
}

function normalizeTypes(value) {
  if (!recordSchema.safeParse(value).success) return null
  return Object.entries(value)
    .slice(0, 500)
    .flatMap(([slug, item]) => {
      if (!isRecord(item)) return []
      const name =
        typeof item.name === 'string' ? item.name.slice(0, 120) : slug
      const taxonomies = Array.isArray(item.taxonomies)
        ? item.taxonomies
            .filter((entry) => typeof entry === 'string')
            .slice(0, 100)
        : []
      return [
        {
          slug: slug.slice(0, 120),
          name,
          restBase:
            typeof item.rest_base === 'string'
              ? item.rest_base.slice(0, 120)
              : null,
          restNamespace:
            typeof item.rest_namespace === 'string'
              ? item.rest_namespace.slice(0, 120)
              : null,
          public: item.public === true,
          taxonomies,
        },
      ]
    })
}

function normalizeTaxonomies(value) {
  if (!recordSchema.safeParse(value).success) return null
  return Object.entries(value)
    .slice(0, 500)
    .flatMap(([slug, item]) => {
      if (!isRecord(item)) return []
      const types = Array.isArray(item.types)
        ? item.types.filter((entry) => typeof entry === 'string').slice(0, 100)
        : []
      return [
        {
          slug: slug.slice(0, 120),
          name: typeof item.name === 'string' ? item.name.slice(0, 120) : slug,
          restBase:
            typeof item.rest_base === 'string'
              ? item.rest_base.slice(0, 120)
              : null,
          restNamespace:
            typeof item.rest_namespace === 'string'
              ? item.rest_namespace.slice(0, 120)
              : null,
          types,
          attachedToProducts: types.includes('product'),
        },
      ]
    })
}

async function inspectEndpoint(fetcher, endpoint, headers, signal, parse) {
  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403)
        return { result: null, status: endpointStatus('denied') }
      if (response.status === 404)
        return { result: null, status: endpointStatus('unavailable') }
      return { result: null, status: endpointStatus('http-error') }
    }
    const result = parse(await readJson(response))
    return result === null
      ? { result: null, status: endpointStatus('invalid-response') }
      : { result, status: endpointStatus('available') }
  } catch {
    return {
      result: null,
      status: endpointStatus(signal.aborted ? 'timeout' : 'unreachable'),
    }
  }
}

async function inspectWordPressEndpoint(
  fetcher,
  endpointForContext,
  headers,
  signal,
  parse,
) {
  const editable = await inspectEndpoint(
    fetcher,
    endpointForContext('edit'),
    headers,
    signal,
    parse,
  )
  if (editable.status.status !== 'denied') return editable

  const publicResult = await inspectEndpoint(
    fetcher,
    endpointForContext('view'),
    headers,
    signal,
    parse,
  )
  return publicResult.status.status === 'available'
    ? { ...publicResult, status: endpointStatus('partial') }
    : publicResult
}

async function discoverShopRest(payload, fetcher) {
  const parsed = connectionSchema.safeParse(payload)
  if (!parsed.success)
    return {
      ok: false,
      error: 'Bitte eine gueltige HTTPS-Shopverbindung pruefen.',
    }

  const base = new URL(parsed.data.url)
  base.pathname = base.pathname.replace(/\/+$/, '') + '/'
  const authorization = `Basic ${Buffer.from(`${parsed.data.consumerKey}:${parsed.data.consumerSecret}`).toString('base64')}`
  const headers = { Authorization: authorization, Accept: 'application/json' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const endpoint = (route, query = {}) => {
    const url = new URL(`wp-json/${route}`, base)
    url.search = new URLSearchParams(query).toString()
    return url.toString()
  }

  try {
    const [index, types, taxonomies, products] = await Promise.all([
      inspectEndpoint(
        fetcher,
        endpoint(''),
        headers,
        controller.signal,
        (value) => {
          if (!isRecord(value)) return null
          const result = namespaceListSchema.safeParse(value.namespaces)
          return result.success ? result.data : null
        },
      ),
      inspectWordPressEndpoint(
        fetcher,
        (context) => endpoint('wp/v2/types', { context }),
        headers,
        controller.signal,
        normalizeTypes,
      ),
      inspectWordPressEndpoint(
        fetcher,
        (context) => endpoint('wp/v2/taxonomies', { context }),
        headers,
        controller.signal,
        normalizeTaxonomies,
      ),
      inspectEndpoint(
        fetcher,
        endpoint('wc/v3/products', {
          per_page: '1',
          status: 'any',
          _fields: 'id,type,attributes,categories',
        }),
        headers,
        controller.signal,
        (value) => {
          const result = productSampleSchema.safeParse(value)
          return result.success
            ? result.data.map((product) => product.type)
            : null
        },
      ),
    ])

    const wooTaxonomies = new Set(
      (taxonomies.result ?? [])
        .filter((taxonomy) => taxonomy.attachedToProducts)
        .map((taxonomy) => taxonomy.slug),
    )
    const postTypes = (types.result ?? []).map((type) => ({
      ...type,
      relation: ['product', 'product_variation'].includes(type.slug)
        ? 'woocommerce-core'
        : type.taxonomies.some((slug) => wooTaxonomies.has(slug))
          ? 'shares-product-taxonomy'
          : 'unclassified',
    }))

    return {
      ok: true,
      url: base.toString(),
      checkedAt: new Date().toISOString(),
      namespaces: index.result ?? [],
      indexStatus: index.status.status,
      postTypes,
      postTypesStatus: types.status.status,
      taxonomies: taxonomies.result ?? [],
      taxonomiesStatus: taxonomies.status.status,
      productApiStatus: products.status.status,
      productTypes: products.result ?? [],
    }
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = { discoverShopRest }
