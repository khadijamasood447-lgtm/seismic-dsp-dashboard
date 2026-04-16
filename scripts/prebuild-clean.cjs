const fs = require('fs')
const path = require('path')

function rmIfExists(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
  } catch {}
}

function main() {
  const root = path.join(__dirname, '..')

  rmIfExists(path.join(root, 'next.config.js'))
  rmIfExists(path.join(root, 'next.config.cjs'))
  rmIfExists(path.join(root, 'pages'))
}

main()

