/**
 * CARDIMG API — Core Library
 * 
 * HTTP API service for indexed CARDIMG data.
 * Reads from the indexer's data directory (ledger.json, mempool.json, images/).
 * Falls back to WhatsOnChain for images not in local cache.
 * 
 * No uploading, no indexing. Just serving.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PROTOCOL_PREFIX = 'CARDIMG'
const WoC_API = 'https://api.whatsonchain.com/v1/bsv/main'

// --- Parsing ---

function parsePushData(buf, offset) {
  const b = buf[offset]
  if (b <= 0x4b) return { data: buf.slice(offset + 1, offset + 1 + b), next: offset + 1 + b }
  if (b === 0x4c) { const l = buf[offset + 1]; return { data: buf.slice(offset + 2, offset + 2 + l), next: offset + 2 + l } }
  if (b === 0x4d) { const l = buf.readUInt16LE(offset + 1); return { data: buf.slice(offset + 3, offset + 3 + l), next: offset + 3 + l } }
  if (b === 0x4e) { const l = buf.readUInt32LE(offset + 1); return { data: buf.slice(offset + 5, offset + 5 + l), next: offset + 5 + l } }
  return null
}

function parseCardImgFromOpReturn(outputs) {
  for (const out of outputs) {
    const buf = Buffer.from(out.hex, 'hex')
    let pos = 0
    if (buf[pos] !== 0x00) continue
    pos++
    if (buf[pos] !== 0x6a) continue
    pos++

    const prefixPush = parsePushData(buf, pos)
    if (!prefixPush) continue
    if (prefixPush.data.toString('ascii') !== PROTOCOL_PREFIX) continue

    const imagePush = parsePushData(buf, prefixPush.next)
    if (!imagePush) continue

    const hash = crypto.createHash('sha256').update(imagePush.data).digest('hex')
    return { hash, image: imagePush.data, size: imagePush.data.length }
  }
  return null
}

function detectMime(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x52 && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  return 'application/octet-stream'
}

// --- State (reads from indexer's data dir) ---

function loadLedger(dataDir) {
  const ledgerPath = path.join(dataDir, 'ledger.json')
  if (fs.existsSync(ledgerPath)) {
    return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  }
  return { cards: {}, lastBlock: 0, totalImages: 0, totalBytes: 0 }
}

function loadMempool(dataDir) {
  const mempoolPath = path.join(dataDir, 'mempool.json')
  if (fs.existsSync(mempoolPath)) {
    return JSON.parse(fs.readFileSync(mempoolPath, 'utf8'))
  }
  return { cards: {}, lastScan: 0 }
}

// --- Chain fallback ---

async function fetchImageFromChain(txid) {
  const res = await fetch(`${WoC_API}/tx/${txid}/opreturn`)
  if (!res.ok) return null
  const outputs = await res.json()
  if (!outputs || outputs.length === 0) return null
  const card = parseCardImgFromOpReturn(outputs)
  return card ? card.image : null
}

async function getOrCreateImage(dataDir, hash) {
  // 1. Check local cache
  const imgPath = path.join(dataDir, 'images', `${hash}.bin`)
  if (fs.existsSync(imgPath)) {
    return fs.readFileSync(imgPath)
  }

  // 2. Look up txid from ledger/mempool and fetch from chain
  const ledger = loadLedger(dataDir)
  const mempool = loadMempool(dataDir)
  const card = ledger.cards[hash] || mempool.cards[hash]
  if (!card) return null

  const imageBuf = await fetchImageFromChain(card.txid)
  if (!imageBuf) return null

  // Cache for next time
  fs.mkdirSync(path.join(dataDir, 'images'), { recursive: true })
  fs.writeFileSync(imgPath, imageBuf)

  return imageBuf
}

async function getTxidHash(dataDir, txid) {
  const ledger = loadLedger(dataDir)
  const mempool = loadMempool(dataDir)
  for (const [hash, card] of Object.entries({ ...mempool.cards, ...ledger.cards })) {
    if (card.txid === txid) return hash
  }
  return null
}

// --- Express app factory ---

function createApp(dataDir) {
  const express = require('express')
  const app = express()

  // CORS — allow all origins
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })

  // GET /stats — index stats
  app.get('/stats', (req, res) => {
    const ledger = loadLedger(dataDir)
    const mempool = loadMempool(dataDir)
    res.json({
      confirmed: ledger.totalImages,
      mempool: Object.keys(mempool.cards).length,
      totalImages: ledger.totalImages + Object.keys(mempool.cards).length,
      totalBytes: ledger.totalBytes,
      lastBlock: ledger.lastBlock
    })
  })

  // GET /list — JSON array of all cards
  app.get('/list', (req, res) => {
    const ledger = loadLedger(dataDir)
    const mempool = loadMempool(dataDir)
    const allCards = { ...mempool.cards, ...ledger.cards }
    const list = Object.entries(allCards).map(([hash, meta]) => ({
      hash,
      ...meta,
      imageUrl: `/img/${hash}`,
      txUrl: `/tx/${meta.txid}`,
      woCLink: `https://whatsonchain.com/tx/${meta.txid}`
    }))
    res.json(list)
  })

  // GET /card/:hash — JSON metadata
  app.get('/card/:hash', (req, res) => {
    const ledger = loadLedger(dataDir)
    const mempool = loadMempool(dataDir)
    const card = ledger.cards[req.params.hash] || mempool.cards[req.params.hash]
    if (!card) return res.status(404).json({ error: 'Not found' })
    res.json({
      hash: req.params.hash,
      ...card,
      woCLink: `https://whatsonchain.com/tx/${card.txid}`,
      imageUrl: `/img/${req.params.hash}`,
      txUrl: `/tx/${card.txid}`
    })
  })

  // GET /img/:hash — raw image bytes (proper content-type)
  app.get('/img/:hash', async (req, res) => {
    try {
      const buf = await getOrCreateImage(dataDir, req.params.hash)
      if (!buf) return res.status(404).json({ error: 'Image not found' })
      res.setHeader('Content-Type', detectMime(buf))
      res.setHeader('Cache-Control', 'public, max-age=31536000')
      res.send(buf)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // GET /tx/:txid — raw image bytes by txid
  app.get('/tx/:txid', async (req, res) => {
    try {
      const txid = req.params.txid
      const hash = await getTxidHash(dataDir, txid)

      let buf
      if (hash) {
        buf = await getOrCreateImage(dataDir, hash)
      } else {
        // Unknown txid — try fetching directly from chain
        buf = await fetchImageFromChain(txid)
        if (buf) {
          const newHash = crypto.createHash('sha256').update(buf).digest('hex')
          fs.mkdirSync(path.join(dataDir, 'images'), { recursive: true })
          fs.writeFileSync(path.join(dataDir, 'images', `${newHash}.bin`), buf)
        }
      }

      if (!buf) return res.status(404).json({ error: 'No CARDIMG output found for this txid' })
      res.setHeader('Content-Type', detectMime(buf))
      res.setHeader('Cache-Control', 'public, max-age=31536000')
      res.send(buf)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return app
}

module.exports = { createApp, loadLedger, loadMempool, getOrCreateImage, detectMime }
