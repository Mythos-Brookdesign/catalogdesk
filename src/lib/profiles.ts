import { z } from 'zod'
import type { Mapping, Options } from '../domain/catalog'

const profileSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  mapping: z.object({
    sku: z.string(),
    name: z.string(),
    price: z.string(),
    stock: z.string(),
    category: z.string(),
    description: z.string(),
  }),
  options: z.object({
    trim: z.boolean(),
    normalizePrices: z.boolean(),
    priceFormat: z.enum(['de', 'en']),
  }),
})
const storeSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSchema).max(20),
})
export type Profile = z.infer<typeof profileSchema>
const key = 'catalogdesk.profiles.v1'

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    return storeSchema.parse(JSON.parse(raw)).profiles
  } catch {
    return []
  }
}

export function saveProfiles(profiles: Profile[]) {
  const store = storeSchema.parse({ version: 1, profiles })
  localStorage.setItem(key, JSON.stringify(store))
}

export function createProfile(
  name: string,
  mapping: Mapping,
  options: Options,
): Profile {
  return profileSchema.parse({
    id: crypto.randomUUID(),
    name,
    mapping,
    options,
  })
}
