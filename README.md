# Trading Card Image API for OpenClaw

HTTP API service for indexed CARDIMG data. Serves card images and metadata from the indexer's data directory. Falls back to WhatsOnChain for images not in local cache.

- **Permissionless** — Serves any indexed CARDIMG image from anyone
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
node scripts/serve.cjs                         # Default port 3014
node scripts/serve.cjs --port 3020             # Custom port
node scripts/serve.cjs --data-dir <path>        # Custom data dir
```

### Library

```javascript
const { createApp } = require('./lib/api.js')

const app = createApp(dataDir)
app.listen(3014)
```

## Endpoints

| Endpoint | Description |
|---|---|
| `GET /list` | JSON array of all cards |
| `GET /stats` | Index stats (confirmed, mempool, totalBytes, lastBlock) |
| `GET /card/:hash` | JSON metadata for a card |
| `GET /img/:hash` | Raw image bytes (proper content-type) |
| `GET /tx/:txid` | Raw image bytes by transaction ID |

## What This Is Not

- Not an uploader (use the [Trading Card Image Uploader](https://github.com/axiemaid/cardimg-upload))
- Not an indexer (use the [CARDIMG indexer](https://github.com/axiemaid/cardimg-indexer))
- No wallet creation or funding (see the [BSV wallet skill](https://github.com/axiemaid/bsv-openclaw-skill))

## License

MIT
