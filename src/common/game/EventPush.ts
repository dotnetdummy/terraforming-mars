/**
 * One event the game can POST.
 *
 * `body` is JSON text. `{{variable}}` is replaced inside that text.
 * Game started and Game ended may repeat `{{#players}}...{{/players}}` once per player.
 * Inside that block, `{{name}}`, `{{link}}`, and `{{color}}` are that player.
 * Game ended also provides `{{vp}}` and `{{megacredits}}` there.
 * A newline in the sent text is `\n` inside the JSON string.
 */
export type EventPushEventConfig = {
  /** True when this event is sent. */
  enabled: boolean;
  body: string;
};

/** One player available inside a `{{#players}}` block. */
export type EventPushPlayer = {
  name: string;
  link: string;
  color: string;
  /** Total victory points. Present for Game ended. */
  vp?: string;
  /** M€ left, the tiebreaker. Present for Game ended. */
  megacredits?: string;
};

/**
 * Where to POST game events, and the body for each one.
 *
 * `token` is a secret. It is stored with the game and is not sent to players.
 */
export type EventPushConfig = {
  url: string;
  token: string;
  gameStarted: EventPushEventConfig;
  waitingForPlayer: EventPushEventConfig;
  /** Absent on games created before this event existed, which means off. */
  gameEnded?: EventPushEventConfig;
};

const SHARED_VARIABLES = ['gameId', 'gameName', 'generation', 'phase', 'playerCount', 'spectatorLink'] as const;

export const GAME_STARTED_VARIABLES = [...SHARED_VARIABLES, 'playerNames', 'playerSummary'] as const;

export const WAITING_FOR_PLAYER_VARIABLES = [...SHARED_VARIABLES, 'playerName', 'playerColor', 'playerLink'] as const;

export const GAME_ENDED_VARIABLES = [...SHARED_VARIABLES, 'resultsLink', 'winnerNames', 'winnerLine'] as const;

export const DEFAULT_GAME_STARTED_BODY = '{ "text": "New game **{{gameName}}** started with {{playerCount}} players:\\n{{#players}}- [{{name}}]({{link}})\\n{{/players}}\\n\\nSpectators can view it from [here]({{spectatorLink}})." }';

export const DEFAULT_WAITING_FOR_PLAYER_BODY = '{ "text": "Waiting for @{{playerName}} \\n- Gen: {{generation}}\\n- Phase: {{phase}}\\n\\nGo to [board]({{playerLink}})." }';

export const DEFAULT_GAME_ENDED_BODY = '{ "text": "**{{gameName}}** ended after gen {{generation}}. {{winnerLine}}\\n{{#players}}- [{{name}}]({{link}}) {{vp}} VP\\n{{/players}}Results: {{resultsLink}}" }';

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;
const PLAYER_BLOCK = /\{\{\s*#players\s*\}\}([\s\S]*?)\{\{\s*\/players\s*\}\}/g;
export const PLAYER_ITEM_VARIABLES = ['name', 'link', 'color'] as const;

export const GAME_ENDED_ITEM_VARIABLES = [...PLAYER_ITEM_VARIABLES, 'vp', 'megacredits'] as const;

type BodyPart =
  | {kind: 'text', text: string}
  | {kind: 'players', inner: string};

const SAMPLE_VALUES: Record<string, string> = {
  gameId: 'g123',
  gameName: 'Remote Carbon Trace',
  generation: '1',
  phase: 'research',
  playerCount: '2',
  spectatorLink: 'http://localhost:8080/spectator?id=s123',
  playerNames: 'Alice, Bob',
  playerSummary: 'Alice (http://localhost:8080/player?id=p1), Bob (http://localhost:8080/player?id=p2)',
  playerName: 'Alice',
  playerColor: 'red',
  playerLink: 'http://localhost:8080/player?id=p1',
  resultsLink: 'http://localhost:8080/the-end?id=s123',
  winnerNames: 'Alice',
  winnerLine: 'Alice won',
};

const SAMPLE_PLAYERS: Array<EventPushPlayer> = [
  {name: 'Alice', link: 'http://localhost:8080/player?id=p1', color: 'red'},
  {name: 'Bob', link: 'http://localhost:8080/player?id=p2', color: 'blue'},
];

const SAMPLE_END_PLAYERS: Array<EventPushPlayer> = [
  {name: 'Alice', link: 'http://localhost:8080/player?id=p1', color: 'red', vp: '80', megacredits: '20'},
  {name: 'Bob', link: 'http://localhost:8080/player?id=p2', color: 'blue', vp: '75', megacredits: '15'},
];

/**
 * Substitutes `{{variable}}` placeholders in `body`.
 *
 * When `players` is passed, `{{#players}}...{{/players}}` is repeated once per player.
 * Inside that block, `itemVariables` are that player. `name`, `link`, and `color` are always available.
 * Each value is inserted as text, with JSON string escaping and no added quotes.
 * Throws when a placeholder is unknown, a block is unclosed, or the result is not JSON.
 */
export function renderEventPushBody(
  body: string,
  values: Readonly<Record<string, string>>,
  allowed: ReadonlyArray<string>,
  players?: ReadonlyArray<EventPushPlayer>,
  itemVariables: ReadonlyArray<string> = PLAYER_ITEM_VARIABLES,
): string {
  const rendered = renderParts(splitPlayerBlocks(body, players), values, allowed, players ?? [], itemVariables);
  JSON.parse(rendered);
  return rendered;
}

/** Placeholder names in `body` that are not in `allowed`. */
function unknownEventPushVariables(body: string, allowed: ReadonlyArray<string>): Array<string> {
  PLACEHOLDER.lastIndex = 0;
  const allowedNames = new Set<string>(allowed);
  const unknown: Array<string> = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (!allowedNames.has(name) && !unknown.includes(name)) {
      unknown.push(name);
    }
  }
  return unknown;
}

/**
 * Why `eventPush` cannot be saved, or undefined when it can.
 *
 * Undefined means event push is off.
 */
export function eventPushError(eventPush: EventPushConfig | null | undefined): string | undefined {
  if (eventPush === undefined || eventPush === null) {
    return undefined;
  }
  if (typeof eventPush !== 'object' || !isEventPushConfig(eventPush)) {
    return 'Event push settings are invalid.';
  }
  if (!isHttpUrl(eventPush.url.trim())) {
    return 'Event push URL must be http or https.';
  }
  if (eventPush.token.trim() === '') {
    return 'Event push token is required.';
  }
  if (!eventPush.gameStarted.enabled && !eventPush.waitingForPlayer.enabled && eventPush.gameEnded?.enabled !== true) {
    return 'Enable Game started, Waiting for player, or Game ended.';
  }
  if (eventPush.gameStarted.enabled) {
    const bodyError = eventPushBodyError(eventPush.gameStarted.body, GAME_STARTED_VARIABLES, SAMPLE_PLAYERS);
    if (bodyError !== undefined) {
      return `Game started: ${bodyError}`;
    }
  }
  if (eventPush.waitingForPlayer.enabled) {
    const bodyError = eventPushBodyError(eventPush.waitingForPlayer.body, WAITING_FOR_PLAYER_VARIABLES);
    if (bodyError !== undefined) {
      return `Waiting for player: ${bodyError}`;
    }
  }
  if (eventPush.gameEnded?.enabled === true) {
    const bodyError = eventPushBodyError(eventPush.gameEnded.body, GAME_ENDED_VARIABLES, SAMPLE_END_PLAYERS, GAME_ENDED_ITEM_VARIABLES);
    if (bodyError !== undefined) {
      return `Game ended: ${bodyError}`;
    }
  }
  return undefined;
}

function eventPushBodyError(
  body: string,
  allowed: ReadonlyArray<string>,
  players?: ReadonlyArray<EventPushPlayer>,
  itemVariables: ReadonlyArray<string> = PLAYER_ITEM_VARIABLES,
): string | undefined {
  const values: Record<string, string> = {};
  for (const name of allowed) {
    values[name] = SAMPLE_VALUES[name] ?? '';
  }
  try {
    renderEventPushBody(body, values, allowed, players, itemVariables);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return 'Body must be JSON after substituting variables.';
    }
    return err instanceof Error ? err.message : 'Body must be JSON after substituting variables.';
  }
  return undefined;
}

function splitPlayerBlocks(body: string, players: ReadonlyArray<EventPushPlayer> | undefined): Array<BodyPart> {
  const parts: Array<BodyPart> = [];
  let last = 0;
  PLAYER_BLOCK.lastIndex = 0;
  for (const match of body.matchAll(PLAYER_BLOCK)) {
    const index = match.index ?? 0;
    parts.push({kind: 'text', text: body.slice(last, index)});
    parts.push({kind: 'players', inner: match[1]});
    last = index + match[0].length;
  }
  parts.push({kind: 'text', text: body.slice(last)});
  const hasBlock = parts.some((part) => part.kind === 'players');
  const remainder = parts.filter((part) => part.kind === 'text').map((part) => part.text).join('');
  if (hasLoosePlayerTag(remainder)) {
    throw new Error('Unclosed {{#players}}.');
  }
  if (hasBlock && players === undefined) {
    throw new Error('Player lists are only available for Game started.');
  }
  return parts;
}

function renderParts(
  parts: ReadonlyArray<BodyPart>,
  values: Readonly<Record<string, string>>,
  allowed: ReadonlyArray<string>,
  players: ReadonlyArray<EventPushPlayer>,
  itemVariables: ReadonlyArray<string>,
): string {
  let rendered = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      rendered += substitute(part.text, values, allowed);
      continue;
    }
    for (const player of players) {
      rendered += substitute(part.inner, playerItemValues(player), itemVariables);
    }
  }
  return rendered;
}

function playerItemValues(player: EventPushPlayer): Record<string, string> {
  const values: Record<string, string> = {
    name: player.name,
    link: player.link,
    color: player.color,
  };
  if (player.vp !== undefined) {
    values.vp = player.vp;
  }
  if (player.megacredits !== undefined) {
    values.megacredits = player.megacredits;
  }
  return values;
}

/** Replaces `{{variable}}` in `text`. `allowed` is the only names that may appear. */
function substitute(
  text: string,
  values: Readonly<Record<string, string>>,
  allowed: ReadonlyArray<string>,
): string {
  const unknown = unknownEventPushVariables(text, allowed);
  if (unknown.length > 0) {
    throw new Error(`Unknown variable ${unknown.join(', ')}`);
  }
  PLACEHOLDER.lastIndex = 0;
  return text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`Missing variable ${name}`);
    }
    return jsonStringContents(value);
  });
}

function hasLoosePlayerTag(text: string): boolean {
  return /\{\{\s*#players\s*\}\}/.test(text) || /\{\{\s*\/players\s*\}\}/.test(text);
}

function isEventPushConfig(value: object): value is EventPushConfig {
  const record = value as EventPushConfig;
  return typeof record.url === 'string' &&
    typeof record.token === 'string' &&
    isEventConfig(record.gameStarted) &&
    isEventConfig(record.waitingForPlayer) &&
    (record.gameEnded === undefined || isEventConfig(record.gameEnded));
}

function isEventConfig(value: EventPushEventConfig | undefined): value is EventPushEventConfig {
  return value !== undefined && typeof value === 'object' && typeof value.enabled === 'boolean' && typeof value.body === 'string';
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The characters of `value` as they appear inside a JSON string. */
function jsonStringContents(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}
