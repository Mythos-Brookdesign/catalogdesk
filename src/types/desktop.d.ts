export type ShopConnection = {
  url: string
  consumerKey: string
  consumerSecret: string
}
export type ShopConnectionResult =
  | { ok: true; url: string; productCount: number; checkedAt: string }
  | { ok: false; error: string }

declare global {
  interface Window {
    catalogDesktop?: {
      testShopConnection: (
        payload: ShopConnection,
      ) => Promise<ShopConnectionResult>
      openCsv: () => Promise<{ name: string; content: string } | null>
      saveCsv: (payload: {
        filename: string
        content: string
      }) => Promise<boolean>
    }
  }
}
