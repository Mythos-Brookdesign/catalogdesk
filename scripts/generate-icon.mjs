import sharp from 'sharp'

const artwork = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" rx="220" fill="#14775c"/><path d="M690 310H385q-75 0-75 75v254q0 75 75 75h305" fill="none" stroke="#fff" stroke-width="72" stroke-linecap="round"/><rect x="550" y="447" width="170" height="52" rx="16" fill="#b9d8a4"/><rect x="550" y="548" width="170" height="52" rx="16" fill="#b9d8a4"/></svg>`
await sharp(Buffer.from(artwork))
  .png()
  .toFile(new URL('../public/icon.png', import.meta.url).pathname)
