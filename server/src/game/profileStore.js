const fs = require('fs')
const path = require('path')

/**
 * Where profiles are persisted.
 *
 * - MongoStore (Bloxity hosting injects MONGODB_URI): one document per profile in
 *   the game's managed database, shared by every pod.
 * - FileStore (local dev): every profile in one JSON file, all kept in memory.
 *
 * Both expose: init(profiles, normalise), load(id), save(changed, profiles),
 * top(key, n, profiles, { min, then }), keepsAll.
 */

function createFileStore() {
  const DIR = path.join(__dirname, '..', '..', 'data')
  const FILE = path.join(DIR, 'profiles.json')

  return {
    keepsAll: true,

    async init(profiles, normalise) {
      try {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
        for (const p of Object.values(raw)) profiles.set(p.id, normalise(p))
        console.log(`[profiles] loaded ${profiles.size} profiles from ${FILE}`)
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn('[profiles] could not read', FILE, err.message)
      }
    },

    // Everything is already in memory.
    async load() {
      return null
    },

    async save(_changed, profiles) {
      fs.mkdirSync(DIR, { recursive: true })
      const json = JSON.stringify(Object.fromEntries(profiles))
      const tmp = `${FILE}.tmp`
      fs.writeFileSync(tmp, json)
      try {
        fs.renameSync(tmp, FILE)
      } catch {
        // Windows/OneDrive can refuse to rename over a file that is being synced.
        fs.writeFileSync(FILE, json)
        fs.rmSync(tmp, { force: true })
      }
    },

    async top(key, n, profiles, { min = 0, then = null } = {}) {
      return [...profiles.values()]
        .filter((p) => p[key] > min && !p.carriedTo)
        .sort((a, b) => b[key] - a[key] || (then ? b[then] - a[then] : 0))
        .slice(0, n)
        .map((p) => ({ name: p.name, value: p[key] }))
    },
  }
}

function createMongoStore(uri) {
  // Loaded only on hosting, so local dev never needs the driver to connect.
  const { MongoClient } = require('mongodb')
  const client = new MongoClient(uri, { maxPoolSize: 10 })
  let col = null

  return {
    keepsAll: false,

    async init() {
      await client.connect()
      col = client.db().collection('profiles')
      await Promise.all([
        col.createIndex({ wins: -1 }),
        col.createIndex({ bestStreak: -1 }),
      ])
      console.log('[profiles] using MongoDB')
    },

    async load(id) {
      return col.findOne({ _id: id })
    },

    async save(changed) {
      if (changed.length === 0) return
      await col.bulkWrite(
        changed.map((p) => {
          const { id, ...doc } = p
          return { replaceOne: { filter: { _id: id }, replacement: { id, ...doc }, upsert: true } }
        }),
        { ordered: false },
      )
    },

    async top(key, n, _profiles, { min = 0, then = null } = {}) {
      const rows = await col
        .find(
          { [key]: { $gt: min }, carriedTo: { $in: ['', null] } },
          { projection: { name: 1, [key]: 1, ...(then ? { [then]: 1 } : {}) } },
        )
        .sort({ [key]: -1, ...(then ? { [then]: -1 } : {}) })
        .limit(n)
        .toArray()
      return rows.map((p) => ({ name: p.name, value: p[key] }))
    },
  }
}

function createStore(mongoUri) {
  return mongoUri ? createMongoStore(mongoUri) : createFileStore()
}

module.exports = { createStore }
