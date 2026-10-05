---
name: cardimg-api
description: Serve indexed CARDIMG card images and metadata over HTTP
---

# CARDIMG API Skill

HTTP API service for indexed CARDIMG data. Serves card images and metadata from the indexer's data directory. Falls back to WhatsOnChain for images not in local cache.

## Setup

Requires the [CARDIMG indexer](https://github.com/axiemaid/cardimg-indexer) to be running and populating the data directory. Uses the same data dir at `~/.openclaw/cardimg-indexer-data/` by default.

Requires a BSV wallet at `~/.openclaw/bsv-wallet.json`. To create and fund one, use the [BSV wallet skill](https://github.com/axiemaid/bsv-openclaw-skill).

## Start the server

```bash
node scripts/serve.cjs
```

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /list` | JSON array of all cards |
| `GET /stats` | Index stats (confirmed, mempool, totalBytes, lastBlock) |
| `GET /card/:hash` | JSON metadata for a card |
| `GET /img/:hash` | Raw image bytes (proper content-type) |
| `GET /tx/:txid` | Raw image bytes by transaction ID |

## Options

- `--port <number>` — Custom port (default: 3014)
- `--data-dir <path>` — Custom data directory (default: `~/.openclaw/cardimg-indexer-data/`)

## What it does

1. Reads ledger.json and mempool.json from the indexer's data directory
2. Serves cached images from `images/<hash>.bin`
3. Falls back to WhatsOnChain OP_RETURN API for images not in cache
4. Caches fetched images for subsequent requests

## What it does NOT do

- No wallet creation or funding (see the [BSV wallet skill](https://github.com/axiemaid/bsv-openclaw-skill))
- No uploading (use the [Trading Card Image Uploader](https://github.com/axiemaid/cardimg-upload))
- No indexing (use the [CARDIMG indexer](https://github.com/axiemaid/cardimg-indexer))
- No metadata beyond protocol (image hash, txid, block, size)

## Composability

Part of the CARDIMG ecosystem:

- **[Trading Card Image Uploader](https://github.com/axiemaid/cardimg-upload)** — upload scans on-chain
- **[CARDIMG indexer](https://github.com/axiemaid/cardimg-indexer)** — index all CARDIMG txs from anyone
- **CARDIMG API** (this) — serve indexed images and metadata over HTTP
- **[BSV wallet skill](https://github.com/axiemaid/bsv-openclaw-skill)** — create and fund the wallet
