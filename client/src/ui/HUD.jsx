import { useEffect } from 'react'

import { useBloxity } from '../bloxity/BloxityContext'
import { sfx } from '../audio/sfx'
import { isPlayingPhase, useGame } from '../net/gameStore'
import { money, useNow } from './format'

const HELP_SEEN_KEY = 'gmn-seen-help'

const open = (modal, tab) => {
  sfx.click()
  useGame.getState().openModal(modal, tab)
}

/** Daily reward waiting: the Rewards tile's "!" badge. */
const rewardsReady = (profile) => Boolean(profile?.dailyAvailable)
/** Quests finished but not yet claimed. */
const questsToClaim = (profile) => profile?.quests.filter((q) => q.progress >= q.goal && !q.claimed).length ?? 0

/** Round buttons in the top bar, styled and sized like Bloxity's toolbar beside them. */
function RoundButton({ label, icon, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="bar-glass bar-btn press pointer-events-auto flex shrink-0 items-center justify-center rounded-full"
    >
      <span className="leading-none">{icon}</span>
    </button>
  )
}

/**
 * Sound and graphics settings. Only outside Bloxity: inside it, Bloxity's own menu
 * (☰) has these settings and a game must not draw a second settings button.
 */
function SettingsButton() {
  const { embedded } = useBloxity()
  if (embedded) return null
  return (
    <RoundButton label="Settings" icon="⚙️" onClick={() => open('settings')} />
  )
}

/**
 * Top bar name card: picture, name, level and progress to the next level. A pill the
 * height of Bloxity's toolbar; the name shortens when the bar runs out of room.
 */
function ProfileCard({ profile }) {
  const { identity } = useBloxity()
  const name = profile?.name || identity?.displayName || identity?.username || 'Guest'
  const level = profile?.level ?? 1
  const pct = profile ? Math.min(100, (profile.xp / profile.xpToNext) * 100) : 0

  return (
    <div className="bar-glass bar-card pointer-events-auto flex min-w-0 items-center rounded-full text-white">
      {identity?.pfp ? (
        <img src={identity.pfp} alt="" className="bar-avatar shrink-0 rounded-full border-2 border-white/80 object-cover" />
      ) : (
        <div className="bar-avatar flex shrink-0 items-center justify-center rounded-full border-2 border-white/80 bg-gradient-to-b from-[#ffb21e] to-[#ff6a1e] font-bold">
          <span className="stroke-thin">{name.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="bar-name truncate font-bold leading-tight">{name}</div>
        <div className="flex items-center gap-1.5">
          <div className="bar-xp min-w-[1.5rem] flex-1 overflow-hidden rounded-full bg-black/45">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#5dff5d] to-[#22c522]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="bar-lv shrink-0 rounded-md bg-gradient-to-b from-[#ffe45c] to-[#f2b200] px-1 font-bold leading-tight text-black">
            LV {level}
          </span>
        </div>
      </div>
    </div>
  )
}

function StatPill({ icon, value, valueClass, plusClass, onPlus }) {
  return (
    <div className="hud-pill ui-panel relative ml-2 flex items-center pl-7 pr-1">
      <span className="absolute -left-2.5 -top-0.5 text-[2rem] leading-none drop-shadow-[0_0.2rem_0_rgba(0,0,0,0.4)]">
        {icon}
      </span>
      <span className={`stroke-text min-w-0 flex-1 truncate text-center text-xl font-bold ${valueClass}`}>{value}</span>
      <button
        type="button"
        onClick={onPlus}
        className={`btn-3d pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${plusClass}`}
      >
        <span className="stroke-text">+</span>
      </button>
    </div>
  )
}

/**
 * Cash and wins. Side by side at the top centre on big screens; on portrait phones
 * stacked under ❓ / ⚙️ in the top-right corner; on landscape phones (no room at the
 * top or on the left there) side by side at the bottom centre. In a row, the weekend
 * boost line sits on the side away from the screen edge.
 */
function Currency({ profile, className = '', row = false, alignEnd = false, atBottom = false }) {
  let layout = 'flex-col items-start'
  if (row) layout = atBottom ? 'flex-col-reverse items-center' : 'flex-col items-center'
  else if (alignEnd) layout = 'flex-col items-end'
  return (
    <div className={`pointer-events-none flex gap-2 ${layout} ${className}`}>
      <div className={`flex gap-2 ${row ? 'flex-row gap-5' : alignEnd ? 'flex-col items-end' : 'flex-col'}`}>
        <StatPill
          icon="💵"
          value={money(profile.cash)}
          valueClass="text-[#5cff5c]"
          plusClass="bg-gradient-to-b from-[#5dff5d] to-[#22c522]"
          onPlus={() => open('shop', 'passes')}
        />
        <StatPill
          icon="🏆"
          value={profile.wins.toLocaleString('en-US')}
          valueClass="text-[#ffd23d]"
          plusClass="bg-gradient-to-b from-[#ffe45c] to-[#f2b200]"
          onPlus={() => open('shop', 'passes')}
        />
      </div>
      {profile.weekend && <div className="rainbow-text -mt-1 text-sm font-bold italic">+2x Weekend Boost</div>}
    </div>
  )
}

/** A big square menu tile with an icon, a label strip and an optional badge. */
function Tile({ label, icon, gradient, onClick, badge, glow = false, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-3d btn-tile hud-tile pointer-events-auto flex flex-col items-center justify-end ${gradient} ${
        glow ? 'tile-glow' : ''
      } ${className}`}
    >
      <span
        className={`hud-tile-icon absolute inset-x-0 top-1 text-center leading-none drop-shadow-[0_0.25rem_0_rgba(0,0,0,0.3)] ${
          glow ? 'wiggle' : ''
        }`}
      >
        {icon}
      </span>
      <span className="hud-tile-label stroke-text mb-1 w-[calc(100%-0.5rem)] whitespace-nowrap rounded-md bg-black/25 py-0.5 text-center font-bold leading-none text-white">
        {label}
      </span>
      {badge && (
        <span className="wiggle absolute -right-2 -top-2 z-10 flex min-w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-1 text-sm font-bold text-white shadow">
          {badge}
        </span>
      )}
    </button>
  )
}

function LeftTiles({ profile, now }) {
  const giftReady = profile.giftAt <= now
  return (
    <div className="hud-left-column pointer-events-none absolute left-3 z-20 flex flex-col gap-3">
      <div className="hud-tile-group flex flex-col gap-3">
        <Tile
          label="SHOP"
          icon="🧺"
          gradient="bg-gradient-to-b from-[#ffe94d] via-[#ffb02e] to-[#ff7a3d]"
          onClick={() => open('shop', 'chairs')}
        />
        <Tile
          label="ITEMS"
          icon="🎒"
          gradient="bg-gradient-to-b from-[#3ee7ff] via-[#2aa8ff] to-[#3b5bff]"
          onClick={() => open('items')}
        />
        <Tile
          label={giftReady ? 'OPEN!' : 'REWARDS'}
          icon="🎁"
          gradient="bg-gradient-to-b from-[#ff4fd8] via-[#c64dff] to-[#8a3dff]"
          onClick={() => open('rewards')}
          badge={rewardsReady(profile) || giftReady ? '!' : null}
          glow={giftReady}
        />
      </div>
    </div>
  )
}

/**
 * Daily quests and the Starter Pack, down the right side (the gift lives in Rewards).
 * On portrait they sit in the top-right column under the bar and cash/wins instead.
 */
function RightTiles({ profile, inCorner = false }) {
  const ready = questsToClaim(profile)
  const done = profile.quests.filter((q) => q.claimed).length
  return (
    <div
      className={
        inCorner
          ? 'hud-right-corner pointer-events-none mt-2 flex-col items-end gap-3'
          : 'hud-right-column pointer-events-none absolute right-3 z-20 flex flex-col gap-3'
      }
    >
      <Tile
        label={done === profile.quests.length ? 'DONE!' : `QUESTS`}
        icon="📜"
        gradient="bg-gradient-to-b from-[#7dff7a] via-[#2fd14f] to-[#169a3a]"
        onClick={() => open('quests')}
        badge={ready ? String(ready) : null}
      />
      {!profile.starterPack && (
        <Tile
          label="STARTER"
          icon="⭐"
          gradient="bg-gradient-to-b from-[#c49bff] via-[#8a5cff] to-[#5b2fd8]"
          onClick={() => open('shop', 'passes')}
          className="hud-tile-optional"
        />
      )}
    </div>
  )
}

/** "LEVEL 5!" with its reward, for a few seconds after levelling up. */
function LevelUpBanner() {
  const levelUp = useGame((s) => s.levelUp)
  useEffect(() => {
    if (!levelUp) return undefined
    const id = setTimeout(() => useGame.setState({ levelUp: null }), Math.max(0, levelUp.until - Date.now()))
    return () => clearTimeout(id)
  }, [levelUp])
  if (!levelUp) return null
  return (
    <div className="pointer-events-none absolute left-1/2 top-[42%] z-50 -translate-x-1/2 -translate-y-1/2 text-center">
      <div className="pop-in flex flex-col items-center">
        <div className="stroke-text text-xl font-bold text-white">LEVEL UP!</div>
        <div className="stroke-text glow text-[4.2rem] font-bold leading-none text-[#ffe23d]">LV {levelUp.level}</div>
        <div className="stroke-text mt-1 text-2xl font-bold text-[#5cff5c]">+{money(levelUp.reward)} 💵</div>
        {levelUp.title && (
          <div className="ui-panel mt-2 px-3 py-1 text-base font-bold text-white">
            New title unlocked: <span className="text-[#ffd23d]">{levelUp.title}</span> 🏷️
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The lobby HUD. Bloxity's toolbar owns the top-left; nothing of ours goes there.
 *   top-right bar: ❓ guide, ⚙️ settings (outside Bloxity) and the name card, one row
 *     lined up with Bloxity's toolbar (same top, same height) and ending before it
 *   left: cash + wins and Shop / Items / Rewards (daily + gift)
 *   right: Quests / Starter Pack
 * Seated at a table, only what the duel needs stays on screen.
 */
export function HUD() {
  const profile = useGame((s) => s.profile)
  const match = useGame((s) => s.match)
  const now = useNow(1000)
  const hasProfile = Boolean(profile)

  // First visit: show "How to Play" once, so nobody is lost in the lobby.
  useEffect(() => {
    if (!hasProfile) return
    try {
      if (localStorage.getItem(HELP_SEEN_KEY)) return
      localStorage.setItem(HELP_SEEN_KEY, '1')
    } catch {
      return
    }
    if (!useGame.getState().modal) useGame.getState().openModal('help')
  }, [hasProfile])

  if (!profile) return null

  // From the countdown on, the duel's VS bar owns the top of the screen.
  const inDuel = match && (match.phase === 'countdown' || isPlayingPhase(match.phase))
  return (
    <>
      {!inDuel && (
        <div className="hud-corner pointer-events-none absolute right-3 z-20 flex flex-col items-end gap-2">
          <div className="bar-row flex w-full min-w-0 items-center justify-end">
            <div className="bar-btns flex items-center">
              <RoundButton label="How to play" icon="❓" onClick={() => open('help')} />
              <SettingsButton />
            </div>
            <ProfileCard profile={profile} />
          </div>
          {!match && <Currency profile={profile} alignEnd className="hud-currency-corner" />}
          {!match && <RightTiles profile={profile} inCorner />}
        </div>
      )}
      {!match && (
        <>
          <LeftTiles profile={profile} now={now} />
          <RightTiles profile={profile} />
          <Currency
            profile={profile}
            row
            className="hud-currency-top hud-top absolute left-1/2 z-20 -translate-x-1/2"
          />
          <Currency
            profile={profile}
            row
            atBottom
            className="hud-currency-bottom absolute bottom-3 left-1/2 z-20 -translate-x-1/2"
          />
        </>
      )}
      <LevelUpBanner />
    </>
  )
}

export default HUD
