import { create } from 'zustand'

/**
 * Event-driven game state for the UI: connection, room roster, tables, the local
 * player's match and profile. Updated by socket.js when messages arrive — never
 * from a frame loop. Server durations ("ends in N ms") are converted to local
 * deadlines on receipt so client clock skew can't matter.
 */

let toastId = 0

export const useGame = create((set, get) => ({
  /** 'connecting' | 'online' | 'offline' */
  status: 'connecting',
  selfId: null,
  roomId: null,
  capacity: 20,
  /** id -> { id, name, streak, equipped, proportions } */
  players: {},
  /** id -> public table state + `endsAt` */
  tables: {},
  /** This player's private match state + `endsAt`, or null when not seated. */
  match: null,
  /** Owner's profile view + `giftAt` / `questResetAt` deadlines. */
  profile: null,
  lb: { streaks: [], wins: [], levels: [], playtime: [] },
  toasts: [],
  /** null | 'shop' | 'items' | 'rewards' | 'quests' | 'help' | 'settings' */
  modal: null,
  shopTab: 'chairs',
  /** Duel outcome banner for this player: { win, reward, theirNumber, until }. */
  result: null,
  /**
   * The guess being revealed at this table: { mine, n, answer, until }. `answer` is
   * null during the suspense, then 'higher' | 'lower' | 'correct'.
   */
  reveal: null,
  /** Level-up celebration: { level, reward, title, until }. */
  levelUp: null,
  emotesOpen: true,

  openModal: (modal, shopTab) => set({ modal, ...(shopTab ? { shopTab } : {}) }),
  closeModal: () => set({ modal: null }),
  setShopTab: (shopTab) => set({ shopTab }),
  toggleEmotes: () => set({ emotesOpen: !get().emotesOpen }),

  pushToast: (text) => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
}))

export const isPlayingPhase = (phase) => phase === 'choosing' || phase === 'guessing'
