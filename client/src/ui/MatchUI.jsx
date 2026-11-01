import { useEffect, useRef } from 'react'

import { sfx } from '../audio/sfx'
import { DATA, emoteById, titleById } from '../game/layout'
import { useSettings } from '../game/quality'
import { useGame } from '../net/gameStore'
import { bubbles } from '../net/liveState'
import { send } from '../net/api'
import { money, useNow } from './format'

const NUMBERS = Array.from({ length: DATA.numberMax - DATA.numberMin + 1 }, (_, i) => DATA.numberMin + i)

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

function PowerButton({ icon, label, price, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="btn-3d press flex flex-1 items-center justify-center gap-2 bg-gradient-to-b from-[#4fd8ff] to-[#2a7bff] px-2 py-1.5 text-white disabled:opacity-45"
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="flex flex-col items-start leading-tight">
        <span className="stroke-thin text-sm font-bold">{label}</span>
        <span className="stroke-thin text-xs font-bold text-[#c8ffc8]">{money(price)}</span>
      </span>
    </button>
  )
}

const ANSWER_STYLE = {
  higher: { label: 'HIGHER', arrow: '⬆', anim: 'arrow-up', bg: 'from-[#5dff7a] to-[#18b84a]', chip: 'bg-[#22c55e]' },
  lower: { label: 'LOWER', arrow: '⬇', anim: 'arrow-down', bg: 'from-[#ffb04d] to-[#ff5a1f]', chip: 'bg-[#f97316]' },
  correct: { label: 'CORRECT!', arrow: '🎯', anim: '', bg: 'from-[#fff15c] to-[#ffb800]', chip: 'bg-[#eab308]' },
}

/**
 * The guess being answered, big in the middle of the screen: "You guessed 50" with
 * a drumroll, then the answer slamming in as HIGHER ⬆ / LOWER ⬇. Both players see
 * it, each from their own side.
 */
function RevealCard({ reveal }) {
  const style = reveal.answer ? ANSWER_STYLE[reveal.answer] : null
  const who = reveal.mine ? 'You guessed' : 'They guessed'
  const detail = !reveal.answer
    ? reveal.mine
      ? 'Is it…'
      : 'Is it your number?'
    : reveal.answer === 'correct'
      ? reveal.mine
        ? 'You got it!'
        : 'They got your number!'
      : reveal.mine
        ? `Their number is ${reveal.answer} than ${reveal.n}`
        : `You told them: ${reveal.answer} than ${reveal.n}`

  // One compact row in the sky under the VS bar, clear of the players' faces.
  return (
    <div className="reveal-pos pointer-events-none absolute left-1/2 z-40 -translate-x-1/2">
      <div className="ui-panel pop-in flex items-center gap-3 px-3 py-2">
        <div className="flex flex-col items-center gap-1">
          <div className="stroke-thin whitespace-nowrap text-xs font-bold text-white/90">{who}</div>
          <div
            className={`btn-3d studs flex size-16 items-center justify-center bg-[#ffd92e] ${reveal.answer ? '' : 'reveal-pulse'}`}
          >
            <span className="stroke-text text-[2.2rem] font-bold leading-none text-white">{reveal.n}</span>
          </div>
        </div>
        <div className="flex min-w-[11rem] flex-col items-center gap-1.5">
          {style ? (
            <div
              key={reveal.answer}
              className={`slam btn-3d flex items-center gap-2 bg-gradient-to-b px-4 py-1 ${style.bg}`}
            >
              <span className={`stroke-text text-[1.9rem] leading-none text-white ${style.anim}`}>{style.arrow}</span>
              <span className="stroke-text text-[1.9rem] font-bold leading-none text-white">{style.label}</span>
              {reveal.answer !== 'correct' && (
                <span className={`stroke-text text-[1.9rem] leading-none text-white ${style.anim}`}>{style.arrow}</span>
              )}
            </div>
          ) : (
            <div className="stroke-text text-[1.9rem] font-bold leading-none text-white">🤔 …</div>
          )}
          <div className="stroke-thin text-center text-sm font-bold text-white">{detail}</div>
        </div>
      </div>
    </div>
  )
}

/** Guesses so far as little chips: "50 ⬇  25 ⬆  37 ⬇". */
function HistoryChips({ label, history }) {
  if (!history?.length) return null
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <span className="stroke-thin mr-1 text-sm font-bold text-white/85">{label}</span>
      {history.map((g, i) => {
        const style = ANSWER_STYLE[g.answer]
        return (
          <span
            key={i}
            className={`rounded-md border-2 border-black/60 px-1.5 text-sm font-bold text-white ${style.chip}`}
          >
            <span className="stroke-thin">
              {g.n} {style.arrow}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/** What a duelist last said (an emote, "Is your number 50? 🤔", "Higher 👆"), while it lasts. */
function speechOf(id, now) {
  const b = id ? bubbles.get(id) : null
  return b && b.text && b.until > now ? b.text : null
}

/** One side of the VS bar: title, name, level/streak, and a speech bubble underneath. */
function DuelistCard({ player, isSelf, active, speech, align }) {
  const title = titleById(player?.title)
  const badges = [`Lv ${player?.level || 1}`, player?.streak > 0 ? `🔥 ${player.streak}` : ''].filter(Boolean).join('  ')
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
 * Top of the screen during a duel: opponent | timer + whose turn | you. The sides
 * match where each player sits on screen (seat 0 is on the right of the duel camera),
 * and what each one says shows under their card instead of over their heads.
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
  else if (match.phase === 'choosing') status = match.myNumber == null ? 'PICK A NUMBER' : 'WAITING…'
  else if (match.myTurn) status = 'YOUR TURN'
  else if (match.pending) status = 'ANSWERING…'
  else status = 'THEIR TURN'

  const myCard = (
    <DuelistCard
      key="me"
      player={self}
      isSelf
      active={match.myTurn}
      speech={speechOf(selfId, now)}
      align={match.seat === 0 ? 'right' : 'left'}
    />
  )
  const theirCard = (
    <DuelistCard
      key="them"
      player={them}
      active={match.theirTurn}
      speech={speechOf(match.opponent, now)}
      align={match.seat === 0 ? 'left' : 'right'}
    />
  )
  return (
    <div className="hud-top pointer-events-none absolute left-1/2 z-40 flex w-[min(94vw,36rem)] -translate-x-1/2 items-start gap-2">
      {match.seat === 0 ? theirCard : myCard}
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
      {match.seat === 0 ? myCard : theirCard}
    </div>
  )
}

/** Paid helpers, shown under the guess grid. */
function PowerButtons({ match }) {
  const cash = useGame((s) => s.profile?.cash ?? 0)
  const use = (kind) => {
    sfx.click()
    send({ t: 'power', kind })
  }
  const revealed = match.revealed != null
  return (
    <div className="mt-2 flex w-full gap-2">
      <PowerButton
        icon="❓"
        label="HINT"
        price={DATA.powers.hint}
        disabled={revealed || match.range[1] - match.range[0] < 3 || cash < DATA.powers.hint}
        onClick={() => use('hint')}
      />
      <PowerButton
        icon="🔍"
        label="REVEAL"
        price={DATA.powers.reveal}
        disabled={revealed || cash < DATA.powers.reveal}
        onClick={() => use('reveal')}
      />
    </div>
  )
}

/**
 * The 1-100 grid: pick a secret number, or guess the opponent's. Numbers the
 * Higher/Lower answers (or a hint) have ruled out are greyed and crossed out.
 */
function NumberGrid({ match, mode }) {
  const { blur } = useSettings()
  const now = useNow(250)
  const scroller = useRef(null)
  const [lo, hi] = mode === 'guess' ? match.range : [DATA.numberMin, DATA.numberMax]

  // Jump straight to the part of the grid that's still in play.
  useEffect(() => {
    const el = scroller.current?.querySelector(`[data-n="${lo}"]`)
    el?.scrollIntoView({ block: 'start' })
  }, [lo])

  const choose = (n) => {
    sfx.click()
    send({ t: mode === 'choose' ? 'pick' : 'guess', n })
  }
  const left = secondsLeft(match.endsAt, now)

  return (
    <div
      className={`pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/30 ${
        blur ? 'backdrop-blur-sm' : ''
      }`}
    >
      <div className="ui-panel pop-in flex w-[min(92vw,30rem)] flex-col items-center p-3">
        <div className="flex w-full items-center justify-between gap-2">
          <h2 className="stroke-text text-2xl font-bold leading-tight text-white">
            {mode === 'choose' ? 'Choose A Number 🤔' : 'Guess Their Number 👀'}
          </h2>
          <span
            className={`btn-3d flex size-10 shrink-0 items-center justify-center text-lg font-bold text-white ${
              left <= 5 ? 'bg-[#e53935]' : 'bg-[#2d6b78]'
            }`}
          >
            <span className="stroke-thin">{left}</span>
          </span>
        </div>
        <p className="mb-2 mt-0.5 w-full text-sm font-semibold text-white/80">
          {mode === 'choose'
            ? 'Your opponent will try to guess it'
            : match.revealed != null
              ? `Their number is ${match.revealed}!`
              : `It's between ${lo} and ${hi}`}
        </p>
        {mode === 'guess' && (
          <div className="mb-2 w-full">
            <HistoryChips label="Your guesses:" history={match.myHistory} />
          </div>
        )}
        <div
          ref={scroller}
          className="game-scroll grid max-h-[min(58vh,26rem)] w-full grid-cols-5 gap-1.5 overflow-y-auto pr-1 portrait:max-h-[52vh]"
        >
          {NUMBERS.map((n) => {
            const out = n < lo || n > hi
            return (
              <button
                type="button"
                key={n}
                data-n={n}
                disabled={out}
                onClick={() => choose(n)}
                className={`btn-3d press studs relative flex aspect-square items-center justify-center text-[1.7rem] font-bold ${
                  out ? 'bg-[#5d6168]' : 'bg-[#ffd92e]'
                }`}
              >
                {out && <span className="absolute inset-0 flex items-center justify-center text-[2.4rem] text-[#ff2d2d]">✖</span>}
                <span className="stroke-text relative text-white">{n}</span>
              </button>
            )
          })}
        </div>
        {mode === 'guess' && <PowerButtons match={match} />}
      </div>
    </div>
  )
}

/** Quick phrases bought in the Emote Shop, said in a bubble over your head. */
function EmotePanel({ hiddenInPortrait }) {
  const owned = useGame((s) => s.profile?.ownedEmotes) || []
  const isOpen = useGame((s) => s.emotesOpen)
  const toggle = useGame((s) => s.toggleEmotes)

  return (
    <div
      className={`pointer-events-none absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2 ${
        hiddenInPortrait ? 'portrait:hidden' : ''
      }`}
    >
      {isOpen && (
        <div className="ui-panel pop-in pointer-events-auto w-[15rem] p-2">
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
      ? 'You left the duel'
      : `Their number was ${result.theirNumber}${result.reward ? `  ·  +${money(result.reward)} for playing` : ''}`

  return (
    <Banner className="top-[30%]">
      <div className="pop-in">
        <div
          className={`stroke-text text-[3.6rem] font-bold leading-none ${result.win ? 'text-[#ffe23d]' : 'text-[#ff4040]'}`}
        >
          {result.win ? 'YOU WIN! 🏆' : 'YOU LOSE 💀'}
        </div>
        <div className="stroke-text mt-2 text-2xl font-bold text-white">{subtitle}</div>
      </div>
    </Banner>
  )
}

/** Everything on screen while seated at a table: waiting, countdown, the duel. */
export function MatchUI() {
  const match = useGame((s) => s.match)
  const reveal = useGame((s) => s.reveal)
  const now = useNow(150)

  // A wood-block tick on each second of the "Starting in 3, 2, 1" countdown.
  const countdown = match?.phase === 'countdown' ? Math.max(1, secondsLeft(match.endsAt, now)) : 0
  useEffect(() => {
    if (countdown) sfx.tick()
  }, [countdown])
  const revealing = Boolean(match && reveal && reveal.until > now)
  const gridOpen =
    (match?.phase === 'choosing' && match.myNumber == null) ||
    (match?.phase === 'guessing' && match.myTurn && !revealing)

  return (
    <>
      {match && <EmotePanel hiddenInPortrait={gridOpen} />}
      {match && !gridOpen && ['countdown', 'choosing', 'guessing'].includes(match.phase) && (
        <DuelBar match={match} now={now} />
      )}

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

      {match?.phase === 'choosing' &&
        (match.myNumber == null ? (
          <NumberGrid match={match} mode="choose" />
        ) : null)}

      {match?.phase === 'guessing' && (
        <>
          {revealing ? (
            <RevealCard reveal={reveal} />
          ) : match.myTurn ? (
            <NumberGrid match={match} mode="guess" />
          ) : (
            match.theirHistory?.length > 0 && (
              <div className="ui-panel pointer-events-none absolute bottom-3 left-1/2 z-30 max-w-[min(56vw,30rem)] -translate-x-1/2 px-3 py-1.5">
                <HistoryChips label="Their guesses:" history={match.theirHistory} />
              </div>
            )
          )}
          {!gridOpen && (
            <div className="pointer-events-none absolute bottom-3 right-3 z-40">
              <LeaveButton label="Quit duel" forfeit />
            </div>
          )}
        </>
      )}

      <ResultBanner />
    </>
  )
}

export default MatchUI
