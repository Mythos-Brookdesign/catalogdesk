const {
  randomBytes,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require('node:crypto')
const { promisify } = require('node:util')
const { z } = require('zod')

const scrypt = promisify(scryptCallback)
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const passwordSchema = z.string().min(12).max(128)
const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9._-]+$/)
const accountSchema = z
  .object({
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(80),
    password: passwordSchema,
    role: z.enum(['admin', 'editor', 'reader']),
  })
  .strict()
const publicUser = ({ id, username, displayName, role }) => ({
  id,
  username,
  displayName,
  role,
})
const roles = {
  admin: new Set([
    'catalog:read',
    'catalog:write',
    'projects:read',
    'projects:write',
    'shop:read',
    'shop:import',
    'shop:manage',
    'transfer:preview',
    'transfer:execute',
    'history:read',
    'history:verify',
    'users:manage',
    'database:manage',
    'theme:write',
    'files:read',
    'files:write',
  ]),
  editor: new Set([
    'catalog:read',
    'catalog:write',
    'projects:read',
    'projects:write',
    'shop:read',
    'shop:import',
    'transfer:preview',
    'history:read',
    'history:verify',
    'theme:write',
    'files:read',
    'files:write',
  ]),
  reader: new Set([
    'catalog:read',
    'projects:read',
    'history:read',
    'theme:write',
  ]),
}
const dummySalt = Buffer.from('c1'.repeat(16), 'hex')
const dummyHash = Buffer.alloc(64, 0xa5)

function createAuthenticator(
  database,
  {
    now = Date.now,
    sessionTtl = 30 * 60_000,
    failuresBeforeLock = 5,
    lockDuration = 60_000,
  } = {},
) {
  const sessions = new Map()
  const failures = new Map()

  async function derive(password, salt) {
    return Buffer.from(await scrypt(password, salt, 64, parameters))
  }
  async function makePassword(password) {
    const validated = passwordSchema.parse(password)
    const salt = randomBytes(16)
    const hash = await derive(validated, salt)
    return { salt: salt.toString('hex'), passwordHash: hash.toString('hex') }
  }
  function createSession(user) {
    const token = randomBytes(32).toString('base64url')
    sessions.set(token, { user: publicUser(user), lastSeen: now() })
    return { sessionToken: token, user: publicUser(user) }
  }
  function requireSession(token, permission) {
    const current = sessions.get(token)
    if (!current || now() - current.lastSeen >= sessionTtl) {
      if (current) sessions.delete(token)
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.')
    }
    const permissions = Array.isArray(permission) ? permission : [permission]
    if (
      !permissions.every((required) => roles[current.user.role]?.has(required))
    )
      throw new Error(
        'Fuer diese Aktion fehlt die erforderliche Benutzerrolle.',
      )
    current.lastSeen = now()
    return current.user
  }
  return {
    async status(token) {
      const state = await database('authState')
      const current = sessions.get(token)
      if (state.setupRequired) return { setupRequired: true, user: null }
      try {
        return {
          setupRequired: false,
          user: current ? requireSession(token, 'catalog:read') : null,
        }
      } catch {
        return { setupRequired: false, user: null }
      }
    },
    async bootstrap(payload) {
      const parsed = z
        .object({
          username: usernameSchema,
          displayName: z.string().trim().min(1).max(80),
          password: passwordSchema,
        })
        .strict()
        .parse(payload)
      const password = await makePassword(parsed.password)
      const user = await database('createInitialAdmin', {
        username: parsed.username.toLowerCase(),
        displayName: parsed.displayName,
        role: 'admin',
        ...password,
      })
      return createSession(user)
    },
    async login(payload) {
      const parsed = z
        .object({ username: usernameSchema, password: passwordSchema })
        .strict()
        .safeParse(payload)
      if (!parsed.success)
        throw new Error(
          'Benutzername oder Passwort ist falsch oder Konto gesperrt.',
        )
      const username = parsed.data.username.toLowerCase()
      const gate = failures.get(username)
      if (gate?.lockedUntil > now())
        throw new Error(
          'Benutzername oder Passwort ist falsch oder Konto gesperrt.',
        )
      const user = await database('findUser', username)
      const candidate = user
        ? await derive(parsed.data.password, Buffer.from(user.salt, 'hex'))
        : await derive(parsed.data.password, dummySalt)
      const expected = user ? Buffer.from(user.passwordHash, 'hex') : dummyHash
      const matches =
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      if (!user || !user.active || !matches) {
        const count = (gate?.count ?? 0) + 1
        failures.set(username, {
          count,
          lockedUntil: count >= failuresBeforeLock ? now() + lockDuration : 0,
        })
        throw new Error(
          'Benutzername oder Passwort ist falsch oder Konto gesperrt.',
        )
      }
      failures.delete(username)
      await database('recordLogin', user.id)
      return createSession(user)
    },
    currentUser: (token) => requireSession(token, 'catalog:read'),
    logout(token) {
      sessions.delete(token)
      return true
    },
    requireSession,
    async listUsers(token) {
      requireSession(token, 'users:manage')
      return database('listUsers')
    },
    async createUser(token, payload) {
      requireSession(token, 'users:manage')
      const parsed = accountSchema.parse(payload)
      const password = await makePassword(parsed.password)
      return database('createUser', {
        username: parsed.username.toLowerCase(),
        displayName: parsed.displayName,
        role: parsed.role,
        ...password,
      })
    },
    async setUserActive(token, payload) {
      const actor = requireSession(token, 'users:manage')
      if (payload?.id === actor.id && payload.active === false)
        throw new Error('Das eigene Konto kann nicht deaktiviert werden.')
      const result = await database('setUserActive', payload)
      if (!payload.active)
        for (const [sessionToken, current] of sessions)
          if (current.user.id === payload.id) sessions.delete(sessionToken)
      return result
    },
  }
}

module.exports = { createAuthenticator, roles }
