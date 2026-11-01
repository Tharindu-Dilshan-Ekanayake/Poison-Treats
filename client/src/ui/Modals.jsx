import { useEffect } from 'react'

import { sfx } from '../audio/sfx'
import { DATA, RARITY_COLORS } from '../game/layout'
import { usePlatform } from '../bloxity/platform'
import { useQuality } from '../game/quality'
import { GRAPHICS, setCameraSpeed, setGraphics, setMusicVolume, setShowFps, setVolume } from '../game/userSettings'
import { useGame } from '../net/gameStore'
import { send } from '../net/api'
import { clock, money, useNow } from './format'

/** The chunky teal-framed window used by every menu, with the red X. */
function Frame({ title, children, tabs }) {
  const close = useGame((s) => s.closeModal)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/55" onClick={close}>
      <div className="pop-in relative w-[min(94vw,36rem)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="stroke-text absolute -top-[0.9em] left-0 right-0 z-10 text-center text-[2.6rem] font-bold leading-none text-white">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => {
            sfx.click()
            close()
          }}
          className="btn-3d press absolute -right-3 -top-4 z-20 flex size-11 items-center justify-center bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] text-2xl font-bold text-white"
        >
          <span className="stroke-text">X</span>
        </button>
        <div className="rounded-2xl border-[4px] border-black bg-gradient-to-b from-[#24606d] to-[#16404a] p-3 pt-8 shadow-2xl">
          {tabs}
          <div className="game-scroll flex max-h-[min(62vh,30rem)] flex-col gap-2 overflow-y-auto pr-1">{children}</div>
        </div>
      </div>
    </div>
  )
}

function Row({ title, titleClass = 'text-white', sub, icon, action, rarity }) {
  const color = rarity ? RARITY_COLORS[rarity] : null
  return (
    <div
      className="relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border-[3px] border-[#6b5800] bg-gradient-to-b from-[#fff35c] to-[#f2c200] py-2 pl-4 pr-3"
      style={color ? { borderColor: color, boxShadow: `inset 0 0 0 2px ${color}55` } : undefined}
    >
      {color && <span className="absolute inset-y-0 left-0 w-2" style={{ background: color }} />}
      {icon}
      <div className="min-w-0 flex-1 leading-none">
        <div className={`stroke-text truncate text-[1.5rem] font-bold ${titleClass}`}>{title}</div>
        <div className="mt-1 flex items-center gap-1.5">
          {rarity && (
            <span
              className="stroke-thin rounded px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-white"
              style={{ background: color }}
            >
              {rarity}
            </span>
          )}
          {sub && <span className="stroke-thin truncate text-sm font-bold text-white">{sub}</span>}
        </div>
      </div>
      {action}
    </div>
  )
}

function ActionButton({ label, onClick, variant = 'buy', disabled = false }) {
  const styles = {
    buy: 'bg-[#22d43a] text-white',
    owned: 'bg-[#3b3e45] text-white',
    equip: 'bg-[#2a8bff] text-white',
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`press btn-3d min-w-[6.5rem] px-3 py-1.5 text-lg font-bold ${styles[variant]}`}
    >
      <span className="stroke-text">{label}</span>
    </button>
  )
}

const buy = (kind, id) => {
  sfx.click()
  send({ t: 'buy', kind, id })
}

const equip = (id) => {
  sfx.click()
  send({ t: 'equip', id })
}

function ChairSwatch({ chair }) {
  return (
    <span
      className="flex size-12 shrink-0 items-center justify-center rounded-lg border-[3px] border-black text-[1.7rem]"
      style={{ background: chair.color }}
    >
      {chair.style === 'throne' ? '👑' : '🪑'}
    </span>
  )
}

function ChairRows({ profile, ownedOnly = false }) {
  return DATA.chairs
    .filter((c) => !ownedOnly || profile.ownedChairs.includes(c.id))
    .map((c) => {
      const owned = profile.ownedChairs.includes(c.id)
      const equipped = profile.equippedChair === c.id
      return (
        <Row
          key={c.id}
          icon={<ChairSwatch chair={c} />}
          title={c.name}
          rarity={c.rarity}
          sub={c.style === 'throne' ? 'Throne' : null}
          titleClass="text-white"
          action={
            equipped ? (
              <ActionButton label="EQUIPPED" variant="owned" disabled />
            ) : owned ? (
              <ActionButton label="EQUIP" variant="equip" onClick={() => equip(c.id)} />
            ) : (
              <ActionButton label={money(c.price)} onClick={() => buy('chair', c.id)} />
            )
          }
        />
      )
    })
}

function EmoteRows({ profile, ownedOnly = false }) {
  return DATA.emotes
    .filter((e) => !ownedOnly || profile.ownedEmotes.includes(e.id))
    .map((e) => {
      const owned = profile.ownedEmotes.includes(e.id)
      return (
        <Row
          key={e.id}
          title={`${e.label} ${e.icon}`}
          titleClass={e.price >= 3500 ? 'text-[#ff4a3d]' : 'text-white'}
          action={
            owned ? (
              <ActionButton label="OWNED" variant="owned" disabled />
            ) : (
              <ActionButton label={money(e.price)} onClick={() => buy('emote', e.id)} />
            )
          }
        />
      )
    })
}

/** A little ring in the halo's colour (the rainbow one cycles). */
function HaloSwatch({ halo }) {
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border-[3px] border-black bg-[#1d2433]">
      <span
        className={`block size-8 rounded-full border-[5px] ${halo.rainbow ? 'halo-rainbow' : ''}`}
        style={halo.rainbow ? undefined : { borderColor: halo.color, boxShadow: `0 0 0.6rem ${halo.color}` }}
      />
    </span>
  )
}

const equipHalo = (id) => {
  sfx.click()
  send({ t: 'equip', kind: 'halo', id })
}

/** Head auras: a glowing halo over your head that everyone sees. */
function HaloRows({ profile, ownedOnly = false }) {
  const owned = profile.ownedHalos || []
  return DATA.halos
    .filter((h) => !ownedOnly || owned.includes(h.id))
    .map((h) => {
      const has = owned.includes(h.id)
      const worn = profile.equippedHalo === h.id
      return (
        <Row
          key={h.id}
          icon={<HaloSwatch halo={h} />}
          title={h.name}
          rarity={h.rarity}
          sub="Glows over your head"
          action={
            worn ? (
              <ActionButton label="TAKE OFF" variant="owned" onClick={() => equipHalo(h.id)} />
            ) : has ? (
              <ActionButton label="WEAR" variant="equip" onClick={() => equipHalo(h.id)} />
            ) : (
              <ActionButton label={money(h.price)} onClick={() => buy('halo', h.id)} />
            )
          }
        />
      )
    })
}

const equipTitle = (id) => {
  sfx.click()
  send({ t: 'equip', kind: 'title', id })
}

/** Titles shown over your name: bought, or earned by reaching a level. */
function TitleRows({ profile, ownedOnly = false }) {
  const owned = profile.ownedTitles || []
  return DATA.titles
    .filter((t) => !ownedOnly || owned.includes(t.id))
    .map((t) => {
      const has = owned.includes(t.id)
      const worn = profile.equippedTitle === t.id
      let action
      if (worn) action = <ActionButton label="TAKE OFF" variant="owned" onClick={() => equipTitle(t.id)} />
      else if (has) action = <ActionButton label="WEAR" variant="equip" onClick={() => equipTitle(t.id)} />
      else if (t.level) action = <ActionButton label={`LV ${t.level}`} variant="owned" disabled />
      else action = <ActionButton label={money(t.price)} onClick={() => buy('title', t.id)} />
      return (
        <Row
          key={t.id}
          icon={
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border-[3px] border-black bg-[#1d2433] text-[1.6rem]">
              🏷️
            </span>
          }
          title={t.name}
          titleClass={t.rainbow ? 'rainbow-text' : 'text-white'}
          rarity={t.rarity}
          sub={t.level ? (has ? 'Earned!' : `Reach level ${t.level}`) : 'Shown above your name'}
          action={action}
        />
      )
    })
}

function PassRows({ profile }) {
  const pack = DATA.starterPack
  const packChair = DATA.chairs.find((c) => c.id === pack.chair)
  return (
    <>
      <Row
        icon={<span className="text-[2.4rem]">⭐</span>}
        title="STARTER PACK"
        titleClass="text-[#ffe23d]"
        sub={`${packChair.name} + ${pack.emotes.length} emotes`}
        action={
          profile.starterPack ? (
            <ActionButton label="OWNED" variant="owned" disabled />
          ) : (
            <ActionButton label={money(pack.price)} onClick={() => buy('starter')} />
          )
        }
      />
      {DATA.passes.map((p) => (
        <Row
          key={p.id}
          icon={<span className="text-[2.4rem]">{p.icon}</span>}
          title={p.name}
          sub={p.desc}
          action={
            profile.passes.includes(p.id) ? (
              <ActionButton label="OWNED" variant="owned" disabled />
            ) : (
              <ActionButton label={money(p.price)} onClick={() => buy('pass', p.id)} />
            )
          }
        />
      ))}
    </>
  )
}

const SHOP_TABS = [
  ['chairs', 'Chairs 🪑'],
  ['auras', 'Auras ✨'],
  ['titles', 'Titles 🏷️'],
  ['emotes', 'Emotes 😄'],
  ['passes', 'Passes ⭐'],
]

function ShopModal({ profile }) {
  const tab = useGame((s) => s.shopTab)
  const setTab = useGame((s) => s.setShopTab)
  const tabs = (
    <div className="mb-2 grid grid-cols-5 gap-1.5">
      {SHOP_TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            sfx.click()
            setTab(id)
          }}
          className={`press btn-3d whitespace-nowrap px-0.5 py-1.5 text-[0.75rem] font-bold text-white ${
            tab === id ? 'bg-[#ff7a1f]' : 'bg-[#2d6b78]'
          }`}
        >
          <span className="stroke-thin">{label}</span>
        </button>
      ))}
    </div>
  )
  return (
    <Frame title={tab === 'emotes' ? 'Emote Shop 😡🥳' : 'Shop 🧺'} tabs={tabs}>
      {tab === 'chairs' && <ChairRows profile={profile} />}
      {tab === 'auras' && <HaloRows profile={profile} />}
      {tab === 'titles' && <TitleRows profile={profile} />}
      {tab === 'emotes' && <EmoteRows profile={profile} />}
      {tab === 'passes' && <PassRows profile={profile} />}
    </Frame>
  )
}

function ItemsModal({ profile }) {
  return (
    <Frame title="Items 🎒">
      <h3 className="stroke-text text-xl font-bold text-white">Chairs</h3>
      <ChairRows profile={profile} ownedOnly />
      {(profile.ownedHalos || []).length > 0 && (
        <>
          <h3 className="stroke-text mt-2 text-xl font-bold text-white">Auras</h3>
          <HaloRows profile={profile} ownedOnly />
        </>
      )}
      {(profile.ownedTitles || []).length > 0 && (
        <>
          <h3 className="stroke-text mt-2 text-xl font-bold text-white">Titles</h3>
          <TitleRows profile={profile} ownedOnly />
        </>
      )}
      <h3 className="stroke-text mt-2 text-xl font-bold text-white">Emotes</h3>
      <EmoteRows profile={profile} ownedOnly />
    </Frame>
  )
}

function RewardsModal({ profile }) {
  const now = useNow(1000)
  const giftReady = profile.giftAt <= now
  return (
    <Frame title="Rewards 🎁">
      <Row
        icon={<span className="text-[2.4rem]">📅</span>}
        title={`Day ${profile.dailyStreak} Reward`}
        sub={profile.dailyAvailable ? `+${money(profile.dailyReward)} · come back daily for more` : 'Come back tomorrow!'}
        action={
          profile.dailyAvailable ? (
            <ActionButton
              label="CLAIM"
              onClick={() => {
                sfx.click()
                send({ t: 'claimDaily' })
              }}
            />
          ) : (
            <ActionButton label="CLAIMED" variant="owned" disabled />
          )
        }
      />
      <Row
        icon={<span className="stroke-text text-[2.4rem] font-bold text-[#62ff3b]">?</span>}
        title="Mystery Gift"
        sub={`${money(DATA.gift.min)} – ${money(DATA.gift.max)} every ${DATA.gift.intervalSec / 60} minutes played`}
        action={
          giftReady ? (
            <ActionButton
              label="OPEN"
              onClick={() => {
                sfx.click()
                send({ t: 'claimGift' })
              }}
            />
          ) : (
            <ActionButton label={clock(profile.giftAt - now)} variant="owned" disabled />
          )
        }
      />
      <Row
        icon={<span className="text-[2.4rem]">⭐</span>}
        title={`Level ${profile.level}`}
        sub={`${profile.xp}/${profile.xpToNext} XP · next level pays +${money(Math.min(DATA.xp.rewardCap, DATA.xp.rewardPerLevel * (profile.level + 1)))}`}
        action={<ActionButton label="PLAY!" variant="equip" onClick={() => useGame.getState().closeModal()} />}
      />
    </Frame>
  )
}

function SettingRow({ icon, label, children }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border-[3px] border-black/50 bg-[#123540] px-3 py-2.5">
      <span className="text-[1.8rem] leading-none">{icon}</span>
      <span className="stroke-thin w-[7.5rem] shrink-0 text-lg font-bold text-white">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  )
}

/** A slider with the value shown beside it. */
function Slider({ value, min, max, step, onChange, format }) {
  return (
    <>
      <input
        type="range"
        className="game-slider min-w-0 flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` }}
      />
      <span className="stroke-thin w-12 text-right text-base font-bold text-white">{format(value)}</span>
    </>
  )
}

const GRAPHICS_LABEL = { low: 'Low', medium: 'Medium', high: 'High' }

function SettingsModal() {
  const volume = usePlatform((s) => s.masterVolume)
  const music = usePlatform((s) => s.musicVolume)
  const cameraSpeed = usePlatform((s) => s.cameraSensitivity)
  const showFps = usePlatform((s) => s.showFps)
  const preset = useQuality((s) => s.preset)

  return (
    <Frame title="Settings ⚙️">
      <SettingRow icon={volume > 0 ? '🔊' : '🔇'} label="Sound">
        <Slider value={Math.round(volume * 100)} min={0} max={100} step={5} onChange={(v) => setVolume(v / 100)} format={(v) => `${v}%`} />
        <button
          type="button"
          onClick={() => {
            setVolume(volume > 0 ? 0 : 0.8)
            sfx.click()
          }}
          className="btn-3d press bg-[#2d6b78] px-2 py-1 text-sm font-bold text-white"
        >
          <span className="stroke-thin">{volume > 0 ? 'MUTE' : 'ON'}</span>
        </button>
      </SettingRow>

      <SettingRow icon="🎵" label="Music">
        <Slider value={Math.round(music * 100)} min={0} max={100} step={5} onChange={(v) => setMusicVolume(v / 100)} format={(v) => `${v}%`} />
      </SettingRow>

      <SettingRow icon="🖥️" label="Graphics">
        {GRAPHICS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => {
              sfx.click()
              setGraphics(g)
            }}
            className={`btn-3d press flex-1 px-1 py-1.5 text-sm font-bold text-white ${
              preset === g ? 'bg-gradient-to-b from-[#ffb04d] to-[#ff7a1f]' : 'bg-[#2d6b78]'
            }`}
          >
            <span className="stroke-thin">{GRAPHICS_LABEL[g]}</span>
          </button>
        ))}
      </SettingRow>
      <p className="-mt-1 px-2 text-xs font-semibold text-white/70">
        Low is smoothest on phones. Higher adds shadows, sharper edges and sparkles.
      </p>

      <SettingRow icon="🎥" label="Camera speed">
        <Slider value={cameraSpeed} min={0.2} max={3} step={0.1} onChange={setCameraSpeed} format={(v) => `${v.toFixed(1)}x`} />
      </SettingRow>

      <SettingRow icon="📈" label="Show FPS">
        <button
          type="button"
          onClick={() => {
            sfx.click()
            setShowFps(!showFps)
          }}
          className={`btn-3d press min-w-[5rem] px-3 py-1.5 text-sm font-bold text-white ${
            showFps ? 'bg-gradient-to-b from-[#5dff5d] to-[#22c522]' : 'bg-[#3b3e45]'
          }`}
        >
          <span className="stroke-thin">{showFps ? 'ON' : 'OFF'}</span>
        </button>
      </SettingRow>
    </Frame>
  )
}

function QuestsModal({ profile }) {
  const now = useNow(1000)
  return (
    <Frame title="Daily Quests 📜">
      <p className="stroke-thin -mt-1 text-center text-sm font-bold text-white/90">
        New quests in {clock(profile.questResetAt - now)} · finish them for big cash!
      </p>
      {profile.quests.map((q) => {
        const done = q.progress >= q.goal
        const pct = Math.min(100, (q.progress / q.goal) * 100)
        return (
          <div
            key={q.id}
            className="flex items-center gap-3 rounded-xl border-[3px] border-[#0d3a1c] bg-gradient-to-b from-[#3fcf63] to-[#1f8f3e] px-3 py-2"
          >
            <span className="text-[2.2rem] leading-none">{q.claimed ? '✅' : done ? '🎉' : '📜'}</span>
            <div className="min-w-0 flex-1">
              <div className="stroke-text truncate text-lg font-bold text-white">{q.label}</div>
              <div className="mt-1 h-3 overflow-hidden rounded-full border-2 border-black/50 bg-black/30">
                <div className="h-full rounded-full bg-gradient-to-r from-[#fff35c] to-[#ffb21e]" style={{ width: `${pct}%` }} />
              </div>
              <div className="stroke-thin mt-0.5 flex justify-between text-sm font-bold text-white">
                <span>
                  {Math.min(q.progress, q.goal)}/{q.goal}
                </span>
                <span className="text-[#fff35c]">+{money(q.reward)}</span>
              </div>
            </div>
            {q.claimed ? (
              <ActionButton label="DONE" variant="owned" disabled />
            ) : (
              <ActionButton
                label="CLAIM"
                disabled={!done}
                variant={done ? 'buy' : 'owned'}
                onClick={() => {
                  sfx.click()
                  send({ t: 'claimQuest', id: q.id })
                }}
              />
            )}
          </div>
        )
      })}
    </Frame>
  )
}

const HELP_STEPS = [
  ['🚶', 'Walk to a table', 'Use WASD (or the joystick on phones). Walk up to a table and press E (or tap "Play").'],
  ['🤔', 'Pick a secret number', 'When a second player sits down, you both pick a number from 1 to 100. Keep it secret!'],
  ['🎯', 'Take turns guessing', "Guess your opponent's number. After each guess you see HIGHER ⬆ or LOWER ⬇. Wrong numbers get crossed out."],
  ['🏆', 'First to guess wins', `Guess right first to win $${DATA.winReward}. Even if you lose, you get $${DATA.lossReward} and XP for playing.`],
  ['❓', 'Need help?', `Use a Hint ($${DATA.powers.hint}) to narrow it down, or Reveal ($${DATA.powers.reveal}) to see their number.`],
  ['⭐', 'Level up', 'Every duel gives XP. Each new level pays cash, and some unlock cool titles for your name.'],
  ['📜', 'Quests & gifts', 'Finish 3 daily quests, open a free gift every 10 minutes, and claim your daily reward.'],
  ['🛍️', 'Spend your cash', 'Buy chairs and thrones, glowing auras, titles and emotes in the Shop. Show them off!'],
  ['🔥', 'Win streaks', 'Win in a row for bonus cash at 3, 5 and 10 wins. Get on the leaderboards!'],
]

/** "How to play" in plain English. Opens by itself on a player's first visit. */
function HelpModal() {
  return (
    <Frame title="How to Play 🤔">
      {HELP_STEPS.map(([icon, title, text], i) => (
        <div key={title} className="flex items-start gap-3 rounded-xl border-[3px] border-black/50 bg-[#123540] px-3 py-2">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[1.8rem]">{icon}</span>
          <div className="min-w-0">
            <div className="stroke-thin text-base font-bold text-[#ffe23d]">
              {i + 1}. {title}
            </div>
            <div className="text-sm font-semibold leading-snug text-white/90">{text}</div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          sfx.click()
          useGame.getState().closeModal()
        }}
        className="btn-3d press mx-auto mt-1 bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-8 py-2 text-xl font-bold text-white"
      >
        <span className="stroke-text">LET&apos;S PLAY!</span>
      </button>
    </Frame>
  )
}

/** Shop, Items and Rewards windows. Lazy-loaded: none are needed to start playing. */
export default function Modals() {
  const modal = useGame((s) => s.modal)
  const profile = useGame((s) => s.profile)
  if (!profile) return null
  if (modal === 'shop') return <ShopModal profile={profile} />
  if (modal === 'items') return <ItemsModal profile={profile} />
  if (modal === 'rewards') return <RewardsModal profile={profile} />
  if (modal === 'settings') return <SettingsModal />
  if (modal === 'quests') return <QuestsModal profile={profile} />
  if (modal === 'help') return <HelpModal />
  return null
}
