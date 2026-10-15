export type ShopConnection = {
  url: string
  consumerKey: string
  consumerSecret: string
}
export type AppRole = 'admin' | 'editor' | 'reader'
export type AppUser = {
  id: string
  username: string
  displayName: string
  role: AppRole
}
export type AuthResult =
  { ok: true; user: AppUser } | { ok: false; error: string }
export type AuthStatus = { setupRequired: boolean; user: AppUser | null }
export type UserRecord = AppUser & {
  active: boolean
  createdAt: string
  lastLoginAt: string | null
}
export type AccountInput = {
  username: string
  displayName: string
  password: string
  role: AppRole
}
export type TransferValues = { regular_price?: string; stock_quantity?: number }
export type TransferProduct = {
  id: number
  sku: string
  type: string
  regular_price: string
  manage_stock: boolean
  stock_quantity: number | null
}
export type TransferEntry = {
  sku: string
  before: TransferProduct | null
  desired: TransferValues
  status: 'ready' | 'blocked' | 'unchanged'
  message: string
}
export type TransferPlan = {
  id: string
  url: string
  createdAt: string
  entries: TransferEntry[]
}
export type TransferStatus =
  | 'pending'
  | 'sending'
  | 'success'
  | 'failed'
  | 'conflict'
  | 'cancelled'
  | 'unknown'
export type TransferItem = {
  id: string
  sku: string
  before: TransferProduct
  desired: TransferValues
  observed: TransferProduct | null
  status: TransferStatus
  message: string
}
export type TransferEvent = {
  sequence: number
  itemId: string
  timestamp: string
  status: TransferStatus
  message: string
  observed: TransferProduct | null
}
export type TransferRun = {
  id: string
  url: string
  createdAt: string
  finishedAt: string | null
  status: 'running' | 'finished' | 'cancelled' | 'interrupted'
  items: TransferItem[]
  events: TransferEvent[]
}
export type HistorySummary = Omit<TransferRun, 'items' | 'events'> & {
  count: number
  counts: Partial<Record<TransferStatus, number>>
}
export type Theme = 'light' | 'dark'
export type ShopConnectionResult =
  | {
      ok: true
      url: string
      productCount: number
      checkedAt: string
      credentialsSaved: boolean
      storageError?: string
    }
  | { ok: false; error: string }

export type ShopImportProgress = {
  loaded: number
  total: number
  page: number
  pages: number
}
export type ProductTaxonomyTerm = {
  id: number | null
  name: string
  slug: string | null
}
export type ProductTaxonomies = {
  categories: ProductTaxonomyTerm[]
  tags: ProductTaxonomyTerm[]
  brands: ProductTaxonomyTerm[]
}
export type ImportedShop = {
  ok: true
  url: string
  dataset: import('../domain/catalog').Dataset
  catalogStored: number
  imported: number
  total: number
  skipped: { type: string; count: number }[]
  simpleProductIds: number[]
  simpleProductTaxonomies: ProductTaxonomies[]
  importedAt: string
  credentialsSaved: boolean
  storageError?: string
}
export type ShopImportResult = ImportedShop | { ok: false; error: string }
export type ShopCatalogInfo = {
  shopUrl: string
  importedAt: string
  importedBy: string
  productCount: number
}
export type StoredShopCatalog = {
  url: string
  importedAt: string
  importedBy: string
  total: number
  imported: number
  skipped: { type: string; count: number }[]
  simpleProductIds: number[]
  simpleProductTaxonomies: ProductTaxonomies[]
  dataset: import('../domain/catalog').Dataset | null
}
export type StoredShopProduct = {
  id: number
  parentId: number | null
  type: string
  sku: string
  name: string
  payload: Record<string, unknown>
}
export type DiscoveryStatus =
  | 'available'
  | 'partial'
  | 'denied'
  | 'unavailable'
  | 'invalid-response'
  | 'http-error'
  | 'timeout'
  | 'unreachable'
export type ShopRestDiscovery = {
  ok: true
  url: string
  checkedAt: string
  namespaces: string[]
  indexStatus: DiscoveryStatus
  postTypes: {
    slug: string
    name: string
    restBase: string | null
    restNamespace: string | null
    public: boolean
    taxonomies: string[]
    relation: 'woocommerce-core' | 'shares-product-taxonomy' | 'unclassified'
  }[]
  postTypesStatus: DiscoveryStatus
  taxonomies: {
    slug: string
    name: string
    restBase: string | null
    restNamespace: string | null
    types: string[]
    attachedToProducts: boolean
    restIndexed: boolean
  }[]
  taxonomiesStatus: DiscoveryStatus
  productApiStatus: DiscoveryStatus
  productTypes: string[]
  commerceResources: {
    categories: DiscoveryStatus
    tags: DiscoveryStatus
    attributes: DiscoveryStatus
  }
  productAttributes: {
    id: number
    name: string
    slug: string
    type: string
  }[]
}

export type ProjectSnapshot = {
  filename: string
  demo: boolean
  dataset: import('../domain/catalog').Dataset
  mapping: import('../domain/catalog').Mapping
  options: import('../domain/catalog').Options
  edits: Record<number, Partial<import('../domain/catalog').Product>>
  excluded: number[]
}
export type ProjectSummary = {
  id: string
  name: string
  filename: string
  productCount: number
  revision: number
  createdAt: string
  updatedAt: string
}
export type SavedProject = ProjectSummary & { snapshot: ProjectSnapshot }
export type SaveProjectInput = {
  id?: string
  revision?: number
  name: string
  snapshot: ProjectSnapshot
}
export type DatabaseResult<Value> =
  { ok: true; value: Value } | { ok: false; error: string }

declare global {
  interface Window {
    catalogDesktop?: {
      authState: () => Promise<AuthStatus>
      bootstrapAdmin: (
        payload: Omit<AccountInput, 'role'>,
      ) => Promise<AuthResult>
      login: (
        payload: Pick<AccountInput, 'username' | 'password'>,
      ) => Promise<AuthResult>
      logout: () => Promise<boolean>
      onAuthExpired: (callback: () => void) => () => void
      listUsers: () => Promise<DatabaseResult<UserRecord[]>>
      createUser: (payload: AccountInput) => Promise<DatabaseResult<UserRecord>>
      setUserActive: (payload: {
        id: string
        active: boolean
      }) => Promise<DatabaseResult<boolean>>
      previewTransfer: (payload: {
        products: { sku: string; price: string; stock: string }[]
        fields: ('price' | 'stock')[]
      }) => Promise<DatabaseResult<TransferPlan>>
      executeTransfer: (payload: {
        planId: string
        selected: string[]
        confirmed: true
      }) => Promise<DatabaseResult<TransferRun>>
      cancelTransfer: () => Promise<void>
      listHistory: (
        page: number,
      ) => Promise<DatabaseResult<{ total: number; runs: HistorySummary[] }>>
      historyDetail: (id: string) => Promise<DatabaseResult<TransferRun>>
      verifyHistory: (id: string) => Promise<DatabaseResult<TransferRun>>
      getTheme: () => Promise<DatabaseResult<Theme>>
      setTheme: (theme: Theme) => Promise<DatabaseResult<Theme>>
      savedShopConnection: () => Promise<DatabaseResult<{ url: string } | null>>
      shopCatalogInfo: (
        url: string,
      ) => Promise<DatabaseResult<ShopCatalogInfo | null>>
      loadLatestShopCatalog: () => Promise<
        DatabaseResult<StoredShopCatalog | null>
      >
      listShopCatalogProducts: (payload: {
        url: string
        page?: number
        pageSize?: number
      }) => Promise<
        DatabaseResult<{
          products: StoredShopProduct[]
          total: number
          page: number
          pageSize: number
        }>
      >
      saveShopProductTaxonomies: (payload: {
        url: string
        productId: number
        taxonomies: ProductTaxonomies
      }) => Promise<DatabaseResult<{ updatedAt: string; updatedBy: string }>>
      saveShopConnection: (
        payload: ShopConnection,
      ) => Promise<DatabaseResult<{ url: string }>>
      deleteShopConnection: () => Promise<DatabaseResult<boolean>>
      importShopProducts: (
        payload: ShopConnection | null,
      ) => Promise<ShopImportResult>
      cancelShopImport: () => Promise<void>
      onShopImportProgress: (
        callback: (progress: ShopImportProgress) => void,
      ) => () => void
      listProjects: () => Promise<DatabaseResult<ProjectSummary[]>>
      loadProject: (id: string) => Promise<DatabaseResult<SavedProject>>
      saveProject: (
        payload: SaveProjectInput,
      ) => Promise<DatabaseResult<ProjectSummary>>
      deleteProject: (payload: {
        id: string
        revision: number
      }) => Promise<DatabaseResult<boolean>>
      databaseInfo: () => Promise<
        DatabaseResult<{ path: string; schemaVersion: number }>
      >
      backupDatabase: () => Promise<DatabaseResult<{ bytes: number } | null>>
      restoreDatabase: () => Promise<
        DatabaseResult<{ setupRequired: boolean } | null>
      >
      testShopConnection: (
        payload: ShopConnection | null,
      ) => Promise<ShopConnectionResult>
      discoverShopRest: (
        payload: ShopConnection | null,
      ) => Promise<ShopRestDiscovery | { ok: false; error: string }>
      openCsv: () => Promise<{ name: string; content: string } | null>
      saveCsv: (payload: {
        filename: string
        content: string
      }) => Promise<boolean>
    }
  }
}
