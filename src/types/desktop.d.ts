export type ShopConnection = {
  url: string
  consumerKey: string
  consumerSecret: string
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
export type ImportedShop = {
  ok: true
  url: string
  dataset: import('../domain/catalog').Dataset
  imported: number
  total: number
  skipped: { type: string; count: number }[]
  importedAt: string
  credentialsSaved: boolean
  storageError?: string
}
export type ShopImportResult = ImportedShop | { ok: false; error: string }

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
      testShopConnection: (
        payload: ShopConnection | null,
      ) => Promise<ShopConnectionResult>
      openCsv: () => Promise<{ name: string; content: string } | null>
      saveCsv: (payload: {
        filename: string
        content: string
      }) => Promise<boolean>
    }
  }
}
