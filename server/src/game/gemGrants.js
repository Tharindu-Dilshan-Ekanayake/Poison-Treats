const fs = require('fs')
const path = require('path')

const { boxity } = require('../bloxity/config')

/**
 * Gems purchases recorded from Bloxity's webhook, keyed by transactionId so a
 * retried webhook is never granted twice. The game has no Gems products yet, so
 * grants are recorded only; when products are added to the Bloxity catalogue,
 * apply unapplied grants to connected players here (by userId).
 */

let mongoCol = null
const FILE = path.join(__dirname, '..', '..', 'data', 'gem-grants.json')

async function collection() {
  if (!boxity.mongoUri) return null
  if (!mongoCol) {
    const { MongoClient } = require('mongodb')
    const client = new MongoClient(boxity.mongoUri, { maxPoolSize: 2 })
    await client.connect()
    mongoCol = client.db().collection('gem_grants')
  }
  return mongoCol
}

async function recordGemGrant(body) {
  const grant = {
    _id: String(body.transactionId),
    userId: String(body.userId),
    username: String(body.username || ''),
    sku: String(body.sku),
    productName: String(body.productName || ''),
    productPrice: Number(body.productPrice) || 0,
    metadata: body.metadata ?? null,
    timestamp: body.timestamp ?? Date.now(),
    applied: false,
  }
  const col = await collection()
  if (col) {
    // Upsert on transactionId: a retried webhook changes nothing.
    await col.updateOne({ _id: grant._id }, { $setOnInsert: grant }, { upsert: true })
    return
  }
  let all = {}
  try {
    all = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    /* first grant */
  }
  if (!all[grant._id]) {
    all[grant._id] = grant
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2))
  }
}

module.exports = { recordGemGrant }
