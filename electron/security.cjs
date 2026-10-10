const path = require('node:path')
const { z } = require('zod')

const saveSchema = z
  .object({
    filename: z.string().regex(/^[a-zA-Z0-9_-]{1,80}\.csv$/),
    content: z.string().max(40 * 1024 * 1024),
  })
  .strict()

function assetPath(url, root) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'catalog:' || parsed.hostname !== 'app')
    throw new Error('Untrusted asset origin')
  const target = path.resolve(root, `.${decodeURIComponent(parsed.pathname)}`)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Asset outside application')
  return target
}

function trustedSender(event, window, expectedUrl) {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === expectedUrl,
  )
}

module.exports = { saveSchema, assetPath, trustedSender }
