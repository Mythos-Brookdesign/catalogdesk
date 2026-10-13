import { expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'

const password = 'CatalogDesk-E2E-Admin-2026!'

export async function initializeTestAdmin(page: Page) {
  const setup = page.getByRole('heading', { name: 'Administrator einrichten' })
  const login = page.getByRole('heading', { name: 'Anmelden', exact: true })
  await expect(setup.or(login)).toBeVisible()
  if (await setup.isVisible()) {
    await page.getByLabel('Benutzername').fill('test-admin')
    await page.getByLabel('Anzeigename').fill('E2E Administrator')
    await page.locator('input[type="password"]').nth(0).fill(password)
    await page.getByLabel('Passwort wiederholen').fill(password)
    await page.getByRole('button', { name: 'Administrator einrichten' }).click()
  } else {
    await page.getByLabel('Benutzername').fill('test-admin')
    await page.locator('input[type="password"]').fill(password)
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
  }
  await expect(
    page.getByRole('heading', { name: 'Produktkatalog', exact: true }),
  ).toBeVisible()
}

export async function launchAuthenticatedElectron(
  playwright: {
    _electron: {
      launch: (options: {
        args: string[]
        env: NodeJS.ProcessEnv
      }) => Promise<ElectronApplication>
    }
  },
  options: { args: string[]; env: NodeJS.ProcessEnv },
) {
  const application = await playwright._electron.launch(options)
  try {
    await initializeTestAdmin(await application.firstWindow())
    return application
  } catch (error) {
    await application.close()
    throw error
  }
}
