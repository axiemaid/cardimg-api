#!/usr/bin/env node
/**
 * CARDIMG API Server
 * 
 * Serves indexed card images and metadata over HTTP.
 * Reads from the indexer's data directory.
 * Falls back to WhatsOnChain for images not in local cache.
 * 
 * Usage:
 *   node scripts/serve.cjs                          # Default port 3014
 *   node scripts/serve.cjs --port 3020             # Custom port
 *   node scripts/serve.cjs --data-dir <path>        # Custom data dir
 */

const path = require('path')
const { createApp } = require('../lib/api.js')

const DEFAULT_PORT = 3014
const DEFAULT_DATA_DIR = path.join(process.env.HOME || '/root', '.openclaw', 'cardimg-indexer-data')

async function main() {
  const args = process.argv.slice(2)
  const portArg = args.indexOf('--port')
  const port = portArg >= 0 ? parseInt(args[portArg + 1]) : DEFAULT_PORT
  const dataDirArg = args.indexOf('--data-dir')
  const dataDir = dataDirArg >= 0 ? args[dataDirArg + 1] : DEFAULT_DATA_DIR

  const fs = require('fs')
  fs.mkdirSync(dataDir, { recursive: true })

  const app = createApp(dataDir)

  app.listen(port, () => {
    console.log('CARDIMG API running at http://localhost:' + port)
    console.log('Data dir:', dataDir)
    console.log('')
    console.log('Endpoints:')
    console.log('  GET /list           → JSON array of all cards')
    console.log('  GET /stats           → index stats')
    console.log('  GET /card/:hash      → JSON metadata')
    console.log('  GET /img/:hash       → raw image bytes')
    console.log('  GET /tx/:txid        → raw image bytes by txid')
  })
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
