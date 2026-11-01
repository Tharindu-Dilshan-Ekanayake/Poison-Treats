const DATA = require('./data')
const profiles = require('./profiles')

const HALF = DATA.world.half
const EMOTE_COOLDOWN_MS = 1500
const ANIM_COOLDOWN_MS = 800
/** Bloxity emote catalogue ids are 24-character hex strings. */
const ANIM_ID = /^[a-f0-9]{24}$/i

const AVATAR_KEYS = [
  'hatId', 'backId', 'skinId', 'headId', 'armLId', 'armRId', 'legLId', 'legRId', 'torsoId',
  'hairId', 'maskId', 'neckId', 'chestId', 'waistId', 'handId', 'shoesId', 'pantsId',
  'shirtId', 'faceId',
]
const PROPORTION_KEYS = [
  'height', 'shoulderWidth', 'armLength', 'legOffsetX', 'torsoScaleX', 'neckHeight', 'headScale',
]

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const finite = (n, fallback = 0) => (Number.isFinite(n) ? n : fallback)

function cleanName(name) {
  const s = String(name || '')
    .replace(/[^\p{L}\p{N}_ .-]/gu, '')
    .trim()
    .slice(0, 20)
  return s || 'Player'
}

function cleanEquipped(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const key of AVATAR_KEYS) {
    const v = raw[key]
    if (typeof v === 'string' || typeof v === 'number') out[key] = String(v).slice(0, 40)
  }
  return out
}

function cleanProportions(raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const key of PROPORTION_KEYS) {
    if (Number.isFinite(raw[key])) out[key] = clamp(raw[key], 0.5, 2)
  }
  return out
}

/**
 * One connected player: their Colyseus client, their synced PlayerState and their
 * persistent profile. Validates everything the client sends before it touches
 * game state.
 */
class Session {
  /**
   * @param {import('@colyseus/core').Client} client
   * @param {import('./GameRoom')} room
   * @param {object} player this player's synced PlayerState
   * @param {{ profileId: string, userId: string, username: string, name: string }} identity
   *   who the player is (see bloxity/identity.js)
   * @param {object} profile their loaded profile
   */
  constructor(client, room, player, identity, profile, options, now) {
    this.client = client
    this.id = client.sessionId
    this.room = room
    this.player = player
    this.seat = null
    this.lastEmoteAt = 0
    this.lastAnimAt = 0
    /** Verified Bloxity account id, or '' for a guest. */
    this.userId = identity.userId

    this.profile = profile
    this.giftReadyAt = now + Math.max(0, DATA.gift.intervalSec - this.profile.giftProgress) * 1000

    player.name = identity.name
    player.uid = identity.userId
    player.uname = identity.username
    player.streak = this.profile.streak
    player.halo = this.profile.equippedHalo || ''
    player.level = this.profile.level
    player.title = this.profile.equippedTitle || ''
    player.x = DATA.world.spawn[0]
    player.y = 0
    player.z = DATA.world.spawn[2]
    player.ry = Math.PI
    player.g = true
    this.setAvatar(options?.equipped, options?.proportions)
  }

  send(type, payload) {
    this.client.send(type, payload)
  }

  toast(text) {
    this.send('toast', { text })
  }

  profileView(now) {
    return profiles.view(this.profile, { now, giftReadyAt: this.giftReadyAt })
  }

  pushProfile(now = Date.now()) {
    this.send('profile', { profile: this.profileView(now) })
  }

  /** Back to the lobby spawn point (after losing a duel). */
  respawn() {
    const [x, y, z] = DATA.world.spawn
    const p = this.player
    p.x = x
    p.y = y
    p.z = z
    p.ry = Math.PI
    p.s = 0
    p.g = true
    this.send('respawn', { x, y, z, ry: Math.PI })
  }

  setAvatar(equipped, proportions) {
    this.player.avatar = JSON.stringify({
      equipped: cleanEquipped(equipped),
      proportions: cleanProportions(proportions),
    })
  }

  /** Banks gift progress so a reconnect doesn't restart the timer. */
  close(now) {
    const remaining = Math.max(0, this.giftReadyAt - now) / 1000
    this.profile.giftProgress = clamp(DATA.gift.intervalSec - remaining, 0, DATA.gift.intervalSec)
    profiles.markDirty(this.profile)
  }

  /** Routes one client message. `msg` is untrusted. */
  handle(type, msg, now) {
    msg = msg && typeof msg === 'object' ? msg : {}
    switch (type) {
      case 'pos':
        return this.onPos(msg)
      case 'sit':
        return this.onSit(msg, now)
      case 'leave':
        return this.seat?.table.leave(this, now)
      case 'pick':
        return this.seat?.table.pick(this, msg.n, now)
      case 'guess':
        return this.seat?.table.guess(this, msg.n, now)
      case 'power': {
        const err = this.seat ? this.seat.table.power(this, msg.kind, now) : 'Sit at a table first'
        if (err) this.toast(err)
        return undefined
      }
      case 'emote':
        return this.onEmote(msg, now)
      case 'buy':
        return this.onBuy(msg, now)
      case 'equip':
        return this.onEquip(msg, now)
      case 'claimQuest':
        return this.onClaimQuest(msg, now)
      case 'claimDaily':
        return this.onClaimDaily(now)
      case 'claimGift':
        return this.onClaimGift(now)
      case 'anim':
        return this.onAnim(msg, now)
      case 'avatar':
        return this.setAvatar(msg.equipped, msg.proportions)
      default:
        return undefined
    }
  }

  onPos(msg) {
    if (this.seat) return
    const p = this.player
    p.x = clamp(finite(msg.x, p.x), -HALF, HALF)
    p.y = clamp(finite(msg.y, 0), -5, 20)
    p.z = clamp(finite(msg.z, p.z), -HALF, HALF)
    p.ry = finite(msg.ry)
    p.s = clamp(finite(msg.s), 0, 20)
    p.g = Boolean(msg.g)
  }

  onSit(msg, now) {
    if (this.seat) return
    const table = this.room.table(msg.table)
    if (!table) return
    const dist = Math.hypot(this.player.x - table.x, this.player.z - table.z)
    if (dist > DATA.table.sitRange + 2) {
      this.toast('Walk closer to the table')
      return
    }
    const err = table.sit(this, now)
    if (err) this.toast(err)
  }

  onEmote(msg, now) {
    if (now - this.lastEmoteAt < EMOTE_COOLDOWN_MS) return
    const emote = DATA.emotes.find((e) => e.id === msg.id)
    if (!emote || !this.profile.ownedEmotes.includes(emote.id)) return
    this.lastEmoteAt = now
    this.room.bubble(this, `${emote.label} ${emote.icon}`)
    profiles.addQuestEvent(this.profile, 'emote', 1, now)
    this.pushProfile(now)
  }

  /** A Bloxity emote animation: replicated to everyone through the synced state. */
  onAnim(msg, now) {
    if (this.seat || now - this.lastAnimAt < ANIM_COOLDOWN_MS) return
    if (typeof msg.id !== 'string' || !ANIM_ID.test(msg.id)) return
    this.lastAnimAt = now
    this.player.emote = msg.id
    this.player.emoteSeq = (this.player.emoteSeq + 1) % 65536
  }

  spend(price) {
    if (this.profile.cash < price) {
      this.toast(`Not enough cash! You need $${price.toLocaleString('en-US')}`)
      return false
    }
    this.profile.cash -= price
    return true
  }

  onBuy(msg, now) {
    const p = this.profile
    if (msg.kind === 'chair') {
      const chair = DATA.chairs.find((c) => c.id === msg.id)
      if (!chair || p.ownedChairs.includes(chair.id)) return
      if (!this.spend(chair.price)) return
      p.ownedChairs.push(chair.id)
      p.equippedChair = chair.id
      this.toast(`Bought ${chair.name}! 🪑`)
    } else if (msg.kind === 'emote') {
      const emote = DATA.emotes.find((e) => e.id === msg.id)
      if (!emote || p.ownedEmotes.includes(emote.id)) return
      if (!this.spend(emote.price)) return
      p.ownedEmotes.push(emote.id)
      this.toast(`Unlocked ${emote.label} ${emote.icon}`)
    } else if (msg.kind === 'halo') {
      const halo = DATA.halos.find((h) => h.id === msg.id)
      if (!halo || p.ownedHalos.includes(halo.id)) return
      if (!this.spend(halo.price)) return
      p.ownedHalos.push(halo.id)
      p.equippedHalo = halo.id
      this.player.halo = halo.id
      this.toast(`${halo.name} unlocked! 😇`)
    } else if (msg.kind === 'title') {
      const title = DATA.titles.find((t) => t.id === msg.id)
      if (!title || !title.price || p.ownedTitles.includes(title.id)) return
      if (!this.spend(title.price)) return
      p.ownedTitles.push(title.id)
      p.equippedTitle = title.id
      this.player.title = title.id
      this.toast(`Title unlocked: ${title.name}! 🏷️`)
    } else if (msg.kind === 'pass') {
      const pass = DATA.passes.find((x) => x.id === msg.id)
      if (!pass || p.passes.includes(pass.id)) return
      if (!this.spend(pass.price)) return
      p.passes.push(pass.id)
      this.toast(`${pass.name} unlocked! ${pass.icon}`)
    } else if (msg.kind === 'starter') {
      if (p.starterPack) return
      const pack = DATA.starterPack
      if (!this.spend(pack.price)) return
      p.starterPack = true
      if (!p.ownedChairs.includes(pack.chair)) p.ownedChairs.push(pack.chair)
      for (const id of pack.emotes) if (!p.ownedEmotes.includes(id)) p.ownedEmotes.push(id)
      this.toast('Starter Pack claimed! ⭐')
    } else {
      return
    }
    profiles.markDirty(this.profile)
    this.pushProfile(now)
    this.seat?.table.sync(now)
  }

  onEquip(msg, now) {
    if (msg.kind === 'title') {
      // Equipping the title you already wear takes it off.
      const p = this.profile
      if (msg.id && !p.ownedTitles.includes(msg.id)) return
      p.equippedTitle = msg.id && p.equippedTitle !== msg.id ? msg.id : ''
      this.player.title = p.equippedTitle
      profiles.markDirty(p)
      this.pushProfile(now)
      return
    }
    if (msg.kind === 'halo') {
      // Equipping the halo you already wear takes it off.
      const p = this.profile
      if (msg.id && !p.ownedHalos.includes(msg.id)) return
      p.equippedHalo = msg.id && p.equippedHalo !== msg.id ? msg.id : ''
      this.player.halo = p.equippedHalo
      profiles.markDirty(p)
      this.pushProfile(now)
      return
    }
    if (!this.profile.ownedChairs.includes(msg.id)) return
    this.profile.equippedChair = msg.id
    profiles.markDirty(this.profile)
    this.pushProfile(now)
    this.seat?.table.sync(now)
  }

  onClaimQuest(msg, now) {
    const p = this.profile
    const quest = DATA.quests.find((q) => q.id === msg.id)
    if (!quest || p.quests.claimed[quest.id]) return
    if ((p.quests.progress[quest.id] || 0) < quest.goal) return
    p.quests.claimed[quest.id] = true
    p.cash += quest.reward
    this.toast(`Quest complete! +$${quest.reward}`)
    profiles.markDirty(this.profile)
    this.pushProfile(now)
  }

  onClaimDaily(now) {
    const p = this.profile
    if (p.daily.lastDay === profiles.dayKey(now)) return
    const { streak, amount } = profiles.dailyRewardFor(p, now)
    p.daily = { lastDay: profiles.dayKey(now), streak }
    p.cash += amount
    this.toast(`Day ${streak} reward: +$${amount}`)
    profiles.markDirty(this.profile)
    this.pushProfile(now)
  }

  onClaimGift(now) {
    if (now < this.giftReadyAt) return
    const { min, max, intervalSec } = DATA.gift
    const amount = Math.round((min + Math.random() * (max - min)) / 10) * 10
    this.profile.cash += amount
    this.profile.giftProgress = 0
    this.giftReadyAt = now + intervalSec * 1000
    this.toast(`Mystery gift: +$${amount} 🎁`)
    profiles.markDirty(this.profile)
    this.pushProfile(now)
  }
}

module.exports = { Session, cleanName }
