const { z } = require('zod')

const connectionSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(2048)
      .url()
      .refine((value) => {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
      }),
    consumerKey: z
      .string()
      .trim()
      .regex(/^ck_[a-f0-9]{40}$/),
    consumerSecret: z
      .string()
      .trim()
      .regex(/^cs_[a-f0-9]{40}$/),
  })
  .strict()

const productsSchema = z
  .array(z.object({ id: z.number().int().positive(), sku: z.string() }))
  .max(1)

async function testConnection(payload, fetcher) {
  const parsed = connectionSchema.safeParse(payload)
  if (!parsed.success)
    return {
      ok: false,
      error:
        'Bitte eine HTTPS-Shopadresse ohne Zugangsdaten, Query oder Fragment und gueltige WooCommerce-Schluessel eingeben.',
    }
  const { url, consumerKey, consumerSecret } = parsed.data
  const base = new URL(url)
  base.pathname = base.pathname.replace(/\/+$/, '') + '/'
  const endpoint = new URL('wp-json/wc/v3/products', base)
  endpoint.search = new URLSearchParams({
    per_page: '1',
    page: '1',
    status: 'any',
    _fields: 'id,sku',
  }).toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetcher(endpoint.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`,
        Accept: 'application/json',
      },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 401 || response.status === 403)
        return {
          ok: false,
          error:
            'Zugriff verweigert. Schluessel, Leseberechtigung und Rechte des WooCommerce-Benutzers pruefen.',
        }
      if (response.status === 404)
        return {
          ok: false,
          error:
            'WooCommerce-API nicht gefunden. Shopadresse und WordPress-Permalinks pruefen.',
        }
      return {
        ok: false,
        error: `Der Shop antwortet mit HTTP ${response.status}. Bitte spaeter erneut versuchen.`,
      }
    }
    if (
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .includes('application/json')
    ) {
      await response.body?.cancel()
      return {
        ok: false,
        error:
          'Der Shop liefert kein JSON. Shopadresse und WooCommerce-REST-API pruefen.',
      }
    }
    const reader = response.body?.getReader()
    if (!reader) return { ok: false, error: 'Die API-Antwort ist leer.' }
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 64 * 1024) {
        await reader.cancel()
        return { ok: false, error: 'Die API-Antwort ist unerwartet gross.' }
      }
      chunks.push(Buffer.from(value))
    }
    const products = productsSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
    )
    const total = response.headers.get('x-wp-total')
    if (
      !products.success ||
      !total ||
      !/^\d+$/.test(total) ||
      !Number.isSafeInteger(Number(total)) ||
      Number(total) < products.data.length
    ) {
      return {
        ok: false,
        error:
          'Die API-Antwort entspricht nicht dem erwarteten WooCommerce-Format.',
      }
    }
    return {
      ok: true,
      url: base.toString(),
      productCount: Number(total),
      checkedAt: new Date().toISOString(),
    }
  } catch {
    return {
      ok: false,
      error: controller.signal.aborted
        ? 'Zeitlimit erreicht. Der Shop hat nach 15 Sekunden nicht geantwortet.'
        : 'Verbindung fehlgeschlagen. HTTPS-Zertifikat, Erreichbarkeit und Shopadresse pruefen. Weiterleitungen werden nicht zugelassen.',
    }
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = { connectionSchema, testConnection }
