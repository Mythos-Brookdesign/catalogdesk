export {}

declare global {
  interface Window {
    catalogDesktop?: {
      openCsv: () => Promise<{ name: string; content: string } | null>
      saveCsv: (payload: {
        filename: string
        content: string
      }) => Promise<boolean>
    }
  }
}
