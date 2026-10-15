#!/usr/bin/env node
/**
 * CARDIMG API Server
 * 
 * Serves indexed CARDIMG and CARDSET data over HTTP.
 * Reads from the indexer's data directory.
 * Falls back to WhatsOnChain for images not in local cache.
 * 
 * Usage:
 *   node scripts/serve.cjs                          # Default port 3014
 *   node scripts/serve.cjs --port 3020               # Custom port
 *   node scripts/serve.cjs --data-dir <path>          # Custom data dir
 *   node scripts/serve.cjs --port 3014 --data-dir ~/.openclaw/cardimg
 */

const path = require('path')
const { createApp } = require('../lib/api.js')

const DEFAULT_PORT = 3014
const DEFAULT_DATA_DIR = path.join(process.env.HOME || '/root', '.openclaw', 'cardimg')

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
    console.log('CARDIMG endpoints:')
    console.log('  GET /list             → JSON array of all cards')
    console.log('  GET /stats            → index stats (cards + sets)')
    console.log('  GET /card/:hash       → JSON metadata (includes CARDSET associations)')
    console.log("  GET /img/:hash        → raw image bytes")
    console.log("  GET /tx/:txid         → raw image bytes by txid")
    console.log("  GET /thumb/:hash      → thumbnail (400px JPEG)")
    console.log("  GET /thumb/tx/:txid   → thumbnail by txid (400px JPEG)")
    console.log('')
    console.log('CARDSET endpoints:')
    console.log('  GET /sets/list        → JSON array of all CARDSETs')
    console.log('  GET /sets/:txid       → single CARDSET with resolved member cards')
    console.log('  GET /card/:hash/sets  → which CARDSETs contain this card')
  })
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
