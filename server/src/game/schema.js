const { schema, t } = require('@colyseus/schema')

/**
 * Synchronised room state. Colyseus diffs it and sends only changed fields to every
 * client at the room's patch rate.
 *
 * Only public information lives here. Each player's secret number, their duel
 * view and their profile (cash, inventory) go to that player alone as messages.
 */

const PlayerState = schema(
  {
    name: t.string(),
    /** Bloxity account id ('' for guests): matches chat messages to players. */
    uid: t.string(),
    /** Bloxity username, for the platform's friend-join toasts. */
    uname: t.string(),
    streak: t.uint16(),
    level: t.uint16(),
    /** Title worn (a DATA.titles id, '' = none). */
    title: t.string(),
    /** Head aura worn (a DATA.halos id, '' = none). */
    halo: t.string(),
    /** Bloxity emote being played, and a counter that changes on every play. */
    emote: t.string(),
    emoteSeq: t.uint16(),
    /** JSON of { equipped, proportions }: changes rarely, and opaque to the server. */
    avatar: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    /** Facing (yaw), horizontal speed, and whether grounded: drive the remote pose. */
    ry: t.float32(),
    s: t.float32(),
    g: t.boolean(),
  },
  'Player',
)

const TableState = schema(
  {
    /** 'waiting' | 'countdown' | 'choosing' | 'guessing' | 'ended' */
    phase: t.string(),
    /** Session ids in the two seats ('' when empty), and each one's equipped chair. */
    seat0: t.string(),
    seat1: t.string(),
    chair0: t.string(),
    chair1: t.string(),
    /** Session id whose turn it is while guessing. */
    turn: t.string(),
    /** Session id of the duel's winner while the result shows: they dance on their chair. */
    winner: t.string(),
    /** Server epoch ms when the current phase times out (0 when it doesn't). */
    endsAt: t.float64(),
  },
  'Table',
)

const GameState = schema(
  {
    players: t.map(PlayerState),
    /** Keyed by table id as a string. */
    tables: t.map(TableState),
  },
  'GameState',
)

module.exports = { PlayerState, TableState, GameState }
