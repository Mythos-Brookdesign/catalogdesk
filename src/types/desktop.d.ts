export type ShopConnection = {
  url: string
  consumerKey: string
  consumerSecret: string
}
export type ShopConnectionResult =
  | { ok: true; url: string; productCount: number; checkedAt: string }
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
