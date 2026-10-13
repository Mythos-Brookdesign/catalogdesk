import { describe, expect, it } from 'vitest'
import { createAuthenticator } from './auth.cjs'

function database() {
  const users = new Map()
  const database = async (operation, payload) => {
    if (operation === 'authState') return { setupRequired: users.size === 0 }
    if (operation === 'createInitialAdmin') {
      if (users.size)
        throw new Error('Ein Administratorkonto ist bereits eingerichtet.')
      const user = { id: 'admin-id', ...payload, active: true }
      users.set(user.username, user)
      return safe(user)
    }
    if (operation === 'findUser') return users.get(payload) ?? null
    if (operation === 'recordLogin') return true
    if (operation === 'listUsers') return [...users.values()].map(safe)
    if (operation === 'createUser') {
      if (users.has(payload.username)) throw new Error('duplicate username')
      const user = { id: `user-${users.size}`, ...payload, active: true }
      users.set(user.username, user)
      return safe(user)
    }
    if (operation === 'setUserActive') {
      const user = [...users.values()].find((item) => item.id === payload.id)
      if (!user) throw new Error('not found')
      user.active = payload.active
      return true
    }
    throw new Error('Unexpected test operation')
  }
  return database
}
const safe = ({ id, username, displayName, role, active }) => ({
  id,
  username,
  displayName,
  role,
  active,
})
const account = (overrides = {}) => ({
  username: 'owner',
  displayName: 'Shop Owner',
  password: 'A-long-test-password-42',
  ...overrides,
})

describe('local account authentication', () => {
  it('bootstraps one admin, hashes passwords and issues opaque in-memory sessions', async () => {
    const db = database()
    const auth = createAuthenticator(db)
    expect(await auth.status()).toEqual({ setupRequired: true, user: null })
    const session = await auth.bootstrap(account())
    expect(session.user).toMatchObject({ username: 'owner', role: 'admin' })
    expect(session.sessionToken).toHaveLength(43)
    expect((await db('findUser', 'owner')).passwordHash).not.toContain(
      'A-long-test-password-42',
    )
    expect((await auth.status(session.sessionToken)).user.id).toBe(
      session.user.id,
    )
    await expect(
      auth.bootstrap(account({ username: 'another' })),
    ).rejects.toThrow('bereits eingerichtet')
  })
  it('enforces password, role, session expiry and failed-login throttling', async () => {
    const db = database()
    let clock = 10_000
    const auth = createAuthenticator(db, {
      now: () => clock,
      failuresBeforeLock: 2,
      lockDuration: 5_000,
      sessionTtl: 10_000,
    })
    await expect(
      auth.bootstrap(account({ password: 'short' })),
    ).rejects.toThrow()
    const admin = await auth.bootstrap(account())
    const reader = await auth.createUser(
      admin.sessionToken,
      account({ username: 'viewer', displayName: 'Viewer', role: 'reader' }),
    )
    await expect(
      auth.login({ username: 'viewer', password: 'Wrong-password-000' }),
    ).rejects.toThrow('gesperrt')
    await expect(
      auth.login({ username: 'viewer', password: 'Wrong-password-000' }),
    ).rejects.toThrow('gesperrt')
    await expect(
      auth.login({ username: 'viewer', password: 'A-long-test-password-42' }),
    ).rejects.toThrow('gesperrt')
    clock += 5_001
    const session = await auth.login({
      username: 'viewer',
      password: 'A-long-test-password-42',
    })
    expect(() =>
      auth.requireSession(session.sessionToken, 'projects:write'),
    ).toThrow('Benutzerrolle')
    expect(auth.requireSession(session.sessionToken, 'projects:read').id).toBe(
      reader.id,
    )
    clock += 10_001
    expect(() => auth.currentUser(session.sessionToken)).toThrow('abgelaufen')
  })
  it('revokes disabled users and prevents the last administrator from locking everyone out', async () => {
    const auth = createAuthenticator(database())
    const admin = await auth.bootstrap(account())
    const user = await auth.createUser(
      admin.sessionToken,
      account({ username: 'editor', role: 'editor' }),
    )
    const login = await auth.login({
      username: 'editor',
      password: 'A-long-test-password-42',
    })
    await expect(
      auth.setUserActive(admin.sessionToken, {
        id: admin.user.id,
        active: false,
      }),
    ).rejects.toThrow('eigene Konto')
    await auth.setUserActive(admin.sessionToken, { id: user.id, active: false })
    expect(() => auth.currentUser(login.sessionToken)).toThrow('abgelaufen')
  })
})
