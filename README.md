# CARDIMG API

HTTP API service for indexed CARDIMG and CARDSET data. Serves card images, metadata, and card set associations from the indexer's data directory. Falls back to WhatsOnChain for images not in local cache.

- **Permissionless** — Serves any indexed CARDIMG image from anyone
- **CARDSET aware** — Lists sets, resolves members, reverse lookup by card hash
- **Chain fallback** — Fetches from WhatsOnChain if image not in local cache
- **CORS enabled** — Any web app can call the API
- **Broadcast:** Uses [WhatsOnChain](https://whatsonchain.com) API for chain fallback

## Install

```bash
git clone https://github.com/axiemaid/cardimg-api.git
cd cardimg-api
npm install
```

Requires the [CARDIMG indexer](https://github.com/axiemaid/cardimg-indexer) to be running and populating the data directory. Requires a BSV wallet at `~/.openclaw/bsv-wallet.json`. To create and fund one, use the [BSV wallet skill](https://github.com/axiemaid/bsv-openclaw-skill).

## Usage

### CLI

```bash
node scripts/serve.cjs                          # Default port 3014, data dir ~/.openclaw/cardimg
node scripts/serve.cjs --port 3020              # Custom port
node scripts/serve.cjs --data-dir <path>         # Custom data dir
node scripts/serve.cjs --port 3014 --data-dir ~/.openclaw/cardimg
```

### Library

```javascript
const { createApp } = require('./lib/api.js')

const app = createApp(dataDir)
app.listen(3014)
```

## Endpoints

### CARDIMG

| Endpoint | Description |
|---|---|
| `GET /list` | JSON array of all cards (txid, hash, blockHeight, size) |
| `GET /stats` | Index stats (card count, set count, total bytes, last block) |
| `GET /card/:hash` | Card metadata + CARDSET associations (reverse lookup) |
| `GET /img/:hash` | Raw image bytes (proper content-type) |
| `GET /tx/:txid` | Raw image bytes by transaction ID (chain fallback) |

### CARDSET

| Endpoint | Description |
|---|---|
| `GET /sets/list` | JSON array of all CARDSETs (cardsetTxid, txids, memberCount, blockHeight) |
| `GET /sets/:txid` | Single CARDSET with resolved member cards (hash, role, imageUrl) |
| `GET /card/:hash/sets` | Reverse lookup — which CARDSETs contain this card |

### Stats Response

```json
{
  "confirmed": 37,
  "mempool": 0,
  "totalImages": 37,
  "totalBytes": 50018749,
  "lastBlock": 971104,
  "sets": {
    "confirmed": 7,
    "mempool": 0,
    "totalSets": 7
  }
}
```

### Set Member Resolution

`GET /sets/:txid` resolves each member txid to card metadata when available:

```json
{
  "cardsetTxid": "42484af6...",
  "blockHeight": 970856,
  "memberCount": 2,
  "members": [
    {
      "txid": "6828ab02...",
      "position": 0,
      "role": "front",
      "hash": "a1b2c3d4...",
      "blockHeight": 970856,
      "size": 560046,
      "imageUrl": "/img/a1b2c3d4...",
      "woCLink": "https://whatsonchain.com/tx/6828ab02..."
    },
    {
      "txid": "d99476b7...",
      "position": 1,
      "role": "back",
      "unresolved": true,
      "woCLink": "https://whatsonchain.com/tx/d99476b7..."
    }
  ]
}
```

Unresolved members (not in local index) still have their txid and WoC link — images can be fetched via `GET /tx/:txid` which falls back to chain.

## What This Is Not

- Not an uploader (use the [Trading Card Image Uploader](https://github.com/axiemaid/cardimg-upload))
- Not an indexer (use the [CARDIMG indexer](https://github.com/axiemaid/cardimg-indexer))
- No wallet creation or funding (see the [BSV wallet skill](https://github.com/axiemaid/bsv-openclaw-skill))

## License

MIT
