import { useEffect } from 'react'

import { sfx } from '../audio/sfx'
import { emoteById, titleById } from '../game/layout'
import { useGame } from '../net/gameStore'
import { bubbles } from '../net/liveState'
import { send } from '../net/api'
import { money, useNow } from './format'

const secondsLeft = (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000))

/** Big centre text (countdown, result), below the VS bar and above the players' heads. */
function Banner({ children, className = '' }) {
  return (
    <div className={`pointer-events-none absolute left-1/2 top-[30%] z-30 w-[92vw] -translate-x-1/2 text-center ${className}`}>
      {children}
    </div>
  )
}

function LeaveButton({ label = 'Leave', forfeit = false }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (forfeit && !window.confirm('Leaving now counts as a loss. Leave anyway?')) return
        sfx.click()
        send({ t: 'leave' })
      }}
      className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-4 py-1.5 text-base font-bold text-white"
    >
      <span className="stroke-thin">{label}</span>
    </button>
  )
}

/**
 * What's happening right now, in one big line under the VS bar: poison a treat,
 * your turn to eat, or who is choosing.
 */
function TurnBanner({ match, theirName }) {
  let text = null
  let tone = 'text-white'
  if (match.phase === 'poisoning') {
    if (match.myPoison < 0) {
      text = 'Tap a treat to POISON it 🧪'
      tone = 'text-[#7dff3a]'
    } else {
      text = `Waiting for ${theirName} to poison one… 🤫`
    }
  } else if (match.phase === 'eating') {
    if (match.pending) {
      text = 'Munching… 😬'
    } else if (match.myTurn) {
      text = 'Your turn! Pick a treat to eat 🍬'
      tone = 'text-[#ffe23d]'
    } else {
      text = `${theirName} is choosing a treat…`
    }
  }
  if (!text) return null
  return (
    <div className="reveal-pos pointer-events-none absolute left-1/2 z-30 w-[94vw] -translate-x-1/2 text-center">
      <span key={text} className={`stroke-text pop-in inline-block text-[1.7rem] font-bold leading-tight ${tone}`}>
        {text}
      </span>
    </div>
  )
}

/** The outcome of the latest bite at this table, slammed onto the screen. */
function BiteBanner() {
  const bite = useGame((s) => s.bite)
  const now = useNow(200)
  if (!bite || bite.until < now) return null
  return (
    <Banner className="top-[38%]">
      <div key={bite.until} className="slam">
        {bite.poisoned ? (
          <div className="stroke-text text-[4rem] font-bold leading-none text-[#7dff3a]">POISONED! ☠️</div>
        ) : (
          <>
            <div className="stroke-text text-[4rem] font-bold leading-none text-[#5cff5c]">SAFE! 😋</div>
            {bite.reward > 0 && (
              <div className="stroke-text mt-1 text-2xl font-bold text-[#ffe23d]">+{money(bite.reward)}</div>
            )}
          </>
        )}
      </div>
    </Banner>
  )
}

/** Reminds the player which treat is their own poison (it glows green). */
function Legend({ match }) {
  if (match.myPoison < 0) return null
  return (
    <div className="ui-panel flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-white">
      <span className="inline-block size-3 rounded-full border border-black/60 bg-[#2fd14f]" />
      <span className="stroke-thin">Your poison</span>
    </div>
  )
}

/** What a player last said (an emote, "SAFE 😋", "Poisoned one 🧪"), while it lasts. */
function speechOf(id, now) {
  const b = id ? bubbles.get(id) : null
  return b && b.text && b.until > now ? b.text : null
}

/** One side of the VS bar: title, name, level/streak/treats eaten, and a speech bubble. */
function DuelistCard({ player, isSelf, active, speech, align, safe }) {
  const title = titleById(player?.title)
  const badges = [`Lv ${player?.level || 1}`, player?.streak > 0 ? `🔥 ${player.streak}` : '', safe > 0 ? `🍬 ${safe}` : '']
    .filter(Boolean)
    .join('  ')
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${align === 'left' ? 'items-start' : 'items-end'}`}>
      <div
        className={`ui-panel flex w-full min-w-0 flex-col px-2.5 py-1 ${
          align === 'left' ? 'items-start text-left' : 'items-end text-right'
        } ${active ? 'turn-ring' : ''}`}
      >
        {title && (
          <span
            className={`max-w-full truncate text-[0.65rem] font-bold leading-tight ${title.rainbow ? 'rainbow-text' : ''}`}
            style={title.rainbow ? undefined : { color: title.color }}
          >
            {title.name}
          </span>
        )}
        <span className="stroke-thin flex max-w-full items-center gap-1 text-base font-bold leading-tight text-white">
          <span className="truncate">{player?.name || '…'}</span>
          {isSelf && <span className="shrink-0 rounded bg-[#2a6bff] px-1 text-[0.6rem]">YOU</span>}
        </span>
        <span className="text-[0.7rem] font-bold leading-tight text-[#ffd23d]">{badges}</span>
      </div>
      {speech && (
        <div
          key={speech}
          className={`speech pop-in max-w-full rounded-xl border-2 border-black/70 bg-white px-2 py-0.5 text-sm font-bold leading-snug text-[#1d2433] ${
            align === 'left' ? 'speech-left' : 'speech-right'
          }`}
        >
          {speech}
        </div>
      )}
    </div>
  )
}

/**
 * Top of the screen during a match: you | timer + whose turn | opponent. What each
 * one says shows under their card instead of over their heads.
 */
function DuelBar({ match, now }) {
  const selfId = useGame((s) => s.selfId)
  const profile = useGame((s) => s.profile)
  const them = useGame((s) => (match.opponent ? s.players[match.opponent] : null))
  const self = {
    name: profile?.name || 'You',
    level: profile?.level,
    streak: profile?.streak,
    title: profile?.equippedTitle,
  }

  const left = secondsLeft(match.endsAt, now)
  let status
  if (match.phase === 'countdown') status = 'GET READY'
  else if (match.phase === 'poisoning') status = match.myPoison < 0 ? 'POISON ONE' : 'WAITING…'
  else if (match.myTurn) status = 'YOUR TURN'
  else if (match.pending) status = 'MUNCHING…'
  else status = 'THEIR TURN'

  return (
    <div className="hud-top pointer-events-none absolute left-1/2 z-40 flex w-[min(94vw,36rem)] -translate-x-1/2 items-start gap-2">
      <DuelistCard
        player={self}
        isSelf
        active={match.myTurn}
        speech={speechOf(selfId, now)}
        align="left"
        safe={match.mySafe}
      />
      <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
        <div
          className={`btn-3d flex size-12 items-center justify-center text-xl font-bold text-white ${
            left <= 5 && match.phase !== 'countdown' ? 'bg-[#e53935]' : 'bg-[#2d6b78]'
          }`}
        >
          <span className="stroke-thin">{match.phase === 'countdown' ? 'VS' : left}</span>
        </div>
        <span
          className={`stroke-thin whitespace-nowrap rounded-md px-1.5 text-[0.7rem] font-bold text-white ${
            match.myTurn ? 'bg-[#22c55e]' : 'bg-black/45'
          }`}
        >
          {status}
        </span>
      </div>
      <DuelistCard
        player={them}
        active={match.theirTurn}
        speech={speechOf(match.opponent, now)}
        align="right"
        safe={match.theirSafe}
      />
    </div>
  )
}

/** Quick phrases bought in the Emote Shop, said in a bubble over your head. */
function EmotePanel() {
  const owned = useGame((s) => s.profile?.ownedEmotes) || []
  const isOpen = useGame((s) => s.emotesOpen)
  const toggle = useGame((s) => s.toggleEmotes)

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2">
      {isOpen && (
        <div className="ui-panel pop-in pointer-events-auto w-[13rem] p-2">
          <div className="game-scroll flex max-h-[min(30vh,14rem)] flex-col gap-1.5 overflow-y-auto pr-1">
            {owned.map((id) => {
              const e = emoteById(id)
              if (!e) return null
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    sfx.pop()
                    send({ t: 'emote', id })
                  }}
                  className="btn-3d press flex items-center justify-between bg-gradient-to-b from-[#fff35c] to-[#f2c200] px-2 py-1"
                >
                  <span className="stroke-thin truncate text-base font-bold text-white">
                    {e.label} {e.icon}
                  </span>
                  <span className="text-xs font-bold text-black/50">USE</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#3ee7ff] to-[#2a6bff] px-3 py-1.5 text-lg font-bold text-white"
      >
        <span className="stroke-text">Emotes 👀</span>
      </button>
    </div>
  )
}

function ResultBanner() {
  const result = useGame((s) => s.result)
  const now = useNow(250)

  useEffect(() => {
    if (!result) return undefined
    const id = setTimeout(() => useGame.setState({ result: null }), Math.max(0, result.until - Date.now()))
    return () => clearTimeout(id)
  }, [result])

  if (!result || result.until < now) return null
  const subtitle = result.win
    ? `+${money(result.reward)} 💵`
    : result.reason === 'forfeit' || result.reason === 'afk'
      ? 'You left the match'
      : `You ate the poison!${result.reward ? `  ·  +${money(result.reward)} for playing` : ''}`

  return (
    <Banner className="top-[30%]">
      <div className="pop-in">
        <div
          className={`stroke-text text-[3.6rem] font-bold leading-none ${result.win ? 'text-[#ffe23d]' : 'text-[#ff4040]'}`}
        >
          {result.win ? 'YOU WIN! 🏆' : result.reason === 'poisoned' ? 'YOU LOSE ☠️' : 'YOU LOSE 💀'}
        </div>
        <div className="stroke-text mt-2 text-2xl font-bold text-white">{subtitle}</div>
      </div>
    </Banner>
  )
}

/** Everything on screen while seated at a table: waiting, countdown, the match. */
export function MatchUI() {
  const match = useGame((s) => s.match)
  const theirName = useGame((s) => (match?.opponent ? s.players[match.opponent]?.name : null)) || 'Opponent'
  const now = useNow(150)

  // A wood-block tick on each second of the "Starting in 3, 2, 1" countdown...
  const countdown = match?.phase === 'countdown' ? Math.max(1, secondsLeft(match.endsAt, now)) : 0
  useEffect(() => {
    if (countdown) sfx.tick()
  }, [countdown])
  // ...and on the last three seconds of your own pick.
  const myPick = (match?.phase === 'eating' && match.myTurn) || (match?.phase === 'poisoning' && match.myPoison < 0)
  const urgent = myPick ? secondsLeft(match.endsAt, now) : 0
  useEffect(() => {
    if (urgent > 0 && urgent <= 3) sfx.tick()
  }, [urgent])

  const inMatch = match && (match.phase === 'poisoning' || match.phase === 'eating')

  return (
    <>
      {match && <EmotePanel />}
      {match && (match.phase === 'countdown' || inMatch) && <DuelBar match={match} now={now} />}
      {inMatch && <TurnBanner match={match} theirName={theirName} />}

      {match?.phase === 'waiting' && (
        <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <span className="stroke-text whitespace-nowrap text-2xl font-bold text-white">Waiting for an opponent… (1/2)</span>
          <LeaveButton />
        </div>
      )}

      {match?.phase === 'countdown' && (
        <>
          <Banner>
            <span className="stroke-text text-[3.6rem] font-bold text-white">
              Starting in {Math.max(1, secondsLeft(match.endsAt, now))}
            </span>
          </Banner>
          <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 -translate-x-1/2">
            <LeaveButton />
          </div>
        </>
      )}

      {inMatch && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 flex flex-col items-end gap-2">
          <Legend match={match} />
          <LeaveButton label="Quit match" forfeit={match.phase === 'eating'} />
        </div>
      )}

      <BiteBanner />
      <ResultBanner />
    </>
  )
}

export default MatchUI
