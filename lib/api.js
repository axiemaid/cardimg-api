/**
 * CARDIMG API — Core Library
 * 
 * HTTP API service for indexed CARDIMG and CARDSET data.
 * Reads from the indexer's data directory (ledger.json, mempool.json,
 * cardset-ledger.json, cardset-mempool.json, images/).
 * Falls back to WhatsOnChain for images not in local cache.
 * 
 * No uploading, no indexing. Just serving.
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PROTOCOL_PREFIX = 'CARDIMG'
const CARDSET_PREFIX = 'CARDSET'
const WoC_API = 'https://api.whatsonchain.com/v1/bsv/main'

let sharp = null
try { sharp = require('sharp') } catch (e) { /* sharp not installed */ }

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

// --- CARDSET state ---

function loadCardsetLedger(dataDir) {
  const ledgerPath = path.join(dataDir, 'cardset-ledger.json')
  if (fs.existsSync(ledgerPath)) {
    return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  }
  return { sets: [], lastBlock: 0, totalSets: 0 }
}

function loadCardsetMempool(dataDir) {
  const mempoolPath = path.join(dataDir, 'cardset-mempool.json')
  if (fs.existsSync(mempoolPath)) {
    return JSON.parse(fs.readFileSync(mempoolPath, 'utf8'))
  }
  return { sets: [], lastScan: 0 }
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
  const allCards = { ...mempool.cards, ...ledger.cards }
  // Ledger is keyed by txid; each value has a 'hash' field
  const card = allCards[txid]
  return card ? card.hash : null
}

// --- CARDSET helpers ---

/**
 * Resolve an array of CARDIMG txids to card metadata (hash, blockHeight, size).
 * Returns array of { txid, hash, blockHeight, size, position } or
 * { txid, position, unresolved: true } for txids not in the index.
 */
function resolveCardsetMembers(dataDir, txids) {
  const ledger = loadLedger(dataDir)
  const mempool = loadMempool(dataDir)
  const allCards = { ...mempool.cards, ...ledger.cards }

  // Build txid → { hash, blockHeight, size } lookup
  // Ledger is keyed by txid; each value has hash, blockHeight, size
  const txidMap = {}
  for (const [txid, meta] of Object.entries(allCards)) {
    txidMap[txid] = { hash: meta.hash, blockHeight: meta.blockHeight, size: meta.size }
  }

  return txids.map((txid, i) => {
    const resolved = txidMap[txid]
    if (resolved) {
      return {
        txid,
        position: i,
        role: i === 0 ? 'front' : i === 1 ? 'back' : 'supplementary',
        ...resolved,
        imageUrl: `/img/${resolved.hash}`,
        woCLink: `https://whatsonchain.com/tx/${txid}`
      }
    }
    return {
      txid,
      position: i,
      role: i === 0 ? 'front' : i === 1 ? 'back' : 'supplementary',
      unresolved: true,
      woCLink: `https://whatsonchain.com/tx/${txid}`
    }
  })
}

/**
 * Reverse lookup: find all CARDSETs that contain a given card txid.
 */
function findSetsForTxid(dataDir, txid) {
  const ledger = loadCardsetLedger(dataDir)
  const mempool = loadCardsetMempool(dataDir)
  const allSets = [...mempool.sets, ...ledger.sets]
  return allSets
    .filter(s => s.txids.includes(txid))
    .map(s => ({
      cardsetTxid: s.cardsetTxid,
      position: s.txids.indexOf(txid),
      role: s.txids.indexOf(txid) === 0 ? 'front' : s.txids.indexOf(txid) === 1 ? 'back' : 'supplementary',
      totalMembers: s.txids.length,
      blockHeight: s.blockHeight || null,
      woCLink: `https://whatsonchain.com/tx/${s.cardsetTxid}`
    }))
}

/**
 * Reverse lookup by card hash (resolves hash→txid first).
 */
function findSetsForHash(dataDir, hash) {
  const ledger = loadLedger(dataDir)
  const mempool = loadMempool(dataDir)
  const allCards = { ...mempool.cards, ...ledger.cards }
  // Find txid by hash — ledger is keyed by txid, value has hash
  const entry = Object.entries(allCards).find(([txid, meta]) => meta.hash === hash)
  if (!entry) return []
  return findSetsForTxid(dataDir, entry[0])
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

  // GET /stats — index stats (CARDIMG + CARDSET)
  app.get('/stats', (req, res) => {
    const ledger = loadLedger(dataDir)
    const mempool = loadMempool(dataDir)
    const csLedger = loadCardsetLedger(dataDir)
    const csMempool = loadCardsetMempool(dataDir)
    res.json({
      confirmed: ledger.totalImages,
      mempool: Object.keys(mempool.cards).length,
      totalImages: ledger.totalImages + Object.keys(mempool.cards).length,
      totalBytes: ledger.totalBytes,
      lastBlock: ledger.lastBlock,
      sets: {
        confirmed: csLedger.sets.length,
        mempool: csMempool.sets.length,
        totalSets: csLedger.sets.length + csMempool.sets.length
      }
    })
  })

  // GET /list — JSON array of all cards
  app.get('/list', (req, res) => {
    const ledger = loadLedger(dataDir)
    const mempool = loadMempool(dataDir)
    const allCards = { ...mempool.cards, ...ledger.cards }
    const list = Object.entries(allCards).map(([txid, meta]) => ({
      txid,
      hash: meta.hash,
      blockHeight: meta.blockHeight,
      size: meta.size,
      imageUrl: `/img/${meta.hash}`,
      txUrl: `/tx/${txid}`,
      woCLink: `https://whatsonchain.com/tx/${txid}`
    }))
    res.json(list)
  })

  // GET /card/:hash — JSON metadata (includes CARDSET associations)
  app.get('/card/:hash', (req, res) => {
    const ledger = loadLedger(dataDir)
    const mempool = loadMempool(dataDir)
    const allCards = { ...mempool.cards, ...ledger.cards }
    const entry = Object.entries(allCards).find(([txid, meta]) => meta.hash === req.params.hash)
    if (!entry) return res.status(404).json({ error: 'Not found' })
    const [txid, card] = entry
    const sets = findSetsForTxid(dataDir, txid)
    res.json({
      hash: req.params.hash,
      txid,
      blockHeight: card.blockHeight,
      size: card.size,
      woCLink: `https://whatsonchain.com/tx/${txid}`,
      imageUrl: `/img/${req.params.hash}`,
      txUrl: `/tx/${txid}`,
      cardsets: sets
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

  // --- Thumbnail generation ---

  async function getOrCreateThumb(dataDir, buf, hash, width) {
    const thumbDir = path.join(dataDir, 'thumbs')
    const thumbPath = path.join(thumbDir, `${hash}_${width}.jpg`)

    // Return cached thumbnail if exists
    if (fs.existsSync(thumbPath)) {
      return fs.readFileSync(thumbPath)
    }

    // Need sharp for resizing
    if (!sharp) return null

    fs.mkdirSync(thumbDir, { recursive: true })

    try {
      const thumb = await sharp(buf)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
      fs.writeFileSync(thumbPath, thumb)
      return thumb
    } catch (e) {
      return null
    }
  }

  // GET /thumb/:hash — thumbnail (400px wide JPEG)
  app.get('/thumb/:hash', async (req, res) => {
    try {
      const buf = await getOrCreateImage(dataDir, req.params.hash)
      if (!buf) return res.status(404).json({ error: 'Image not found' })

      const thumb = await getOrCreateThumb(dataDir, buf, req.params.hash, 400)
      if (thumb) {
        res.setHeader('Content-Type', 'image/jpeg')
        res.setHeader('Cache-Control', 'public, max-age=31536000')
        return res.send(thumb)
      }

      // Fallback to full image if sharp not available
      res.setHeader('Content-Type', detectMime(buf))
      res.setHeader('Cache-Control', 'public, max-age=31536000')
      res.send(buf)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // GET /thumb/tx/:txid — thumbnail by txid (400px wide JPEG)
  app.get('/thumb/tx/:txid', async (req, res) => {
    try {
      const txid = req.params.txid
      const hash = await getTxidHash(dataDir, txid)

      let buf, thumbHash
      if (hash) {
        buf = await getOrCreateImage(dataDir, hash)
        thumbHash = hash
      } else {
        buf = await fetchImageFromChain(txid)
        if (buf) {
          thumbHash = crypto.createHash('sha256').update(buf).digest('hex')
          fs.mkdirSync(path.join(dataDir, 'images'), { recursive: true })
          fs.writeFileSync(path.join(dataDir, 'images', `${thumbHash}.bin`), buf)
        }
      }

      if (!buf) return res.status(404).json({ error: 'No CARDIMG output found for this txid' })

      const thumb = await getOrCreateThumb(dataDir, buf, thumbHash, 400)
      if (thumb) {
        res.setHeader('Content-Type', 'image/jpeg')
        res.setHeader('Cache-Control', 'public, max-age=31536000')
        return res.send(thumb)
      }

      // Fallback to full image
      res.setHeader('Content-Type', detectMime(buf))
      res.setHeader('Cache-Control', 'public, max-age=31536000')
      res.send(buf)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // ─── CARDSET endpoints ───

  // GET /sets/list — JSON array of all CARDSETs
  app.get('/sets/list', (req, res) => {
    const csLedger = loadCardsetLedger(dataDir)
    const csMempool = loadCardsetMempool(dataDir)
    const allSets = [...csMempool.sets, ...csLedger.sets]
    const list = allSets.map(s => ({
      cardsetTxid: s.cardsetTxid,
      txids: s.txids,
      memberCount: s.txids.length,
      blockHeight: s.blockHeight || null,
      woCLink: `https://whatsonchain.com/tx/${s.cardsetTxid}`
    }))
    res.json(list)
  })

  // GET /sets/:txid — single CARDSET with resolved member cards
  app.get('/sets/:txid', (req, res) => {
    const csLedger = loadCardsetLedger(dataDir)
    const csMempool = loadCardsetMempool(dataDir)
    const allSets = [...csMempool.sets, ...csLedger.sets]
    const set = allSets.find(s => s.cardsetTxid === req.params.txid)
    if (!set) return res.status(404).json({ error: 'CARDSET not found' })
    const members = resolveCardsetMembers(dataDir, set.txids)
    res.json({
      cardsetTxid: set.cardsetTxid,
      blockHeight: set.blockHeight || null,
      memberCount: set.txids.length,
      members,
      woCLink: `https://whatsonchain.com/tx/${set.cardsetTxid}`
    })
  })

  // GET /card/:hash/sets — which CARDSETs contain this card
  app.get('/card/:hash/sets', (req, res) => {
    const sets = findSetsForHash(dataDir, req.params.hash)
    res.json({ hash: req.params.hash, cardsets: sets })
  })

  return app
}

module.exports = {
  createApp,
  loadLedger,
  loadMempool,
  loadCardsetLedger,
  loadCardsetMempool,
  getOrCreateImage,
  resolveCardsetMembers,
  findSetsForTxid,
  findSetsForHash,
  detectMime
}
