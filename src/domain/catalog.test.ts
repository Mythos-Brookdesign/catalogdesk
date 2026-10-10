import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import {
  analyzeCatalog,
  defaultOptions,
  exportReport,
  exportWooCommerce,
  normalizePrice,
  parseCsv,
  suggestMapping,
} from './catalog'

const csv =
  'Artikelnummer;Produktname;Preis;Bestand\n A-01 ; Trinkflasche ;19,90;12\nA-02;Licht;ungueltig;3\nA-02;Tasche;24,50;-1\n;Helm;59,90;2'
const dataset = parseCsv(csv)
const mapping = suggestMapping(dataset.headers)
const analyze = (edits = {}, excluded: number[] = []) =>
  analyzeCatalog({ dataset, mapping, options: defaultOptions, edits, excluded })

describe('CSV import', () => {
  it('detects delimiters, BOM and quoted multiline fields', () => {
    expect(
      parseCsv('\uFEFFSKU,Name,Price\r\n001,"Bottle, large\nred",12.50')
        .rows[0],
    ).toEqual(['001', 'Bottle, large\nred', '12.50'])
    expect(dataset.delimiter).toBe(';')
  })
  it('rejects empty, duplicate and malformed columns', () => {
    for (const text of [
      '',
      'SKU,SKU\n1,2',
      'SKU,\n1,2',
      'SKU,Name\n1,2,3',
      'SKU,Name',
    ])
      expect(() => parseCsv(text)).toThrow()
  })
})

describe('price normalization', () => {
  it('keeps decimal conventions explicit', () => {
    expect(normalizePrice('1.234,50 EUR', 'de')).toBe('1234.50')
    expect(normalizePrice('1,234.50', 'en')).toBe('1234.50')
    expect(normalizePrice('0,00', 'de')).toBe('0.00')
    for (const value of ['12.50', '-1', '19,999', 'NaN', '1e3', '=1+2'])
      expect(normalizePrice(value, 'de')).toBeNull()
  })
})

describe('validation and export', () => {
  it('marks every duplicate, missing fields and bad stock; preserves originals', () => {
    const result = analyze()
    expect(result.valid).toBe(1)
    expect(result.invalid).toBe(3)
    expect(result.rows[0].original.price).toBe('19,90')
    expect(result.rows[0].product.price).toBe('19.90')
    expect(result.rows[1].issues.some((issue) => issue.field === 'sku')).toBe(
      true,
    )
    expect(result.rows[2].issues.map((issue) => issue.field)).toContain('stock')
    expect(() => exportWooCommerce(result)).toThrow()
  })
  it('allows reviewed corrections and exclusions, exporting drafts only', () => {
    const result = analyze({ 1: { price: '12,50' }, 3: { sku: 'A-04' } }, [2])
    expect(result.invalid).toBe(0)
    const output = Papa.parse<string[]>(
      exportWooCommerce(result).replace(/^\uFEFF/, ''),
    ).data
    expect(output).toHaveLength(4)
    expect(output[1].slice(0, 5)).toEqual([
      'simple',
      'A-01',
      'Trinkflasche',
      '-1',
      '19.90',
    ])
    expect(output[0]).not.toContain('Manage stock?')
    expect(output[0]).toContain('Visibility in catalog')
    expect(exportReport(result)).toContain('Ausgeschlossen')
  })
  it('blocks unmapped required fields and empty exports', () => {
    const result = analyzeCatalog({
      dataset,
      mapping: { ...mapping, name: '' },
      options: defaultOptions,
      edits: {},
      excluded: [],
    })
    expect(result.missing).toEqual(['name'])
    expect(() => exportWooCommerce(result)).toThrow()
    expect(() => exportWooCommerce(analyze({}, [0, 1, 2, 3]))).toThrow()
  })
  it('neutralizes spreadsheet formula injection', () => {
    const result = analyze(
      { 0: { name: '=HYPERLINK("https://example.com")' } },
      [1, 2, 3],
    )
    expect(exportWooCommerce(result)).toContain("'=HYPERLINK")
    expect(exportReport(result)).toContain("'=HYPERLINK")
  })
})
