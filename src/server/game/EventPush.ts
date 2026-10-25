import { paths } from '@/common/app/paths';
import { DEFAULT_URL_ROOT } from '@/common/constants';
import {
  EventPushConfig,
  EventPushPlayer,
  GAME_STARTED_VARIABLES,
  renderEventPushBody,
  WAITING_FOR_PLAYER_VARIABLES,
} from '@/common/game/EventPush';
import { PlayerId } from '@/common/Types';
import { IGame } from '../IGame';
import { IPlayer } from '../IPlayer';

const URL_ROOT = process.env.URL_ROOT || DEFAULT_URL_ROOT;
const TIMEOUT_MS = 5000;

/** Players who currently have a required input. */
export function playersWithRequiredInput(game: IGame): Set<PlayerId> {
  const ids = new Set<PlayerId>();
  for (const player of game.players) {
    const waitingFor = player.getWaitingFor();
    if (waitingFor !== undefined && waitingFor.optional !== true) {
      ids.add(player.id);
    }
  }
  return ids;
}

/** Sends Game started, then Waiting for player for everyone who must act now. */
export function notifyGameCreated(game: IGame): void {
  if (game.eventPush === undefined) {
    return;
  }
  send(game, 'gameStarted', gameStartedValues(game), eventPushPlayers(game));
  notifyNewWaits(game, new Set());
}

/**
 * Sends Waiting for player for players who now have a required input and did not before.
 */
export function notifyNewWaits(
  game: IGame,
  previouslyWaiting: ReadonlySet<PlayerId>,
): void {
  if (game.eventPush?.waitingForPlayer.enabled !== true) {
    return;
  }
  for (const player of game.playersInGenerationOrder) {
    if (previouslyWaiting.has(player.id)) {
      continue;
    }
    const waitingFor = player.getWaitingFor();
    if (waitingFor === undefined || waitingFor.optional === true) {
      continue;
    }
    send(game, 'waitingForPlayer', waitingForPlayerValues(game, player));
  }
}

function send(
  game: IGame,
  which: 'gameStarted' | 'waitingForPlayer',
  values: Readonly<Record<string, string>>,
  players?: ReadonlyArray<EventPushPlayer>,
): void {
  const config = game.eventPush;
  if (config === undefined) {
    return;
  }
  const event = config[which];
  if (event.enabled !== true) {
    return;
  }
  const allowed =
    which === 'gameStarted' ?
      GAME_STARTED_VARIABLES :
      WAITING_FOR_PLAYER_VARIABLES;
  let body: string;
  try {
    body = renderEventPushBody(event.body, values, allowed, players);
  } catch (err) {
    console.warn(
      `Event push for game ${game.id} was not sent:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }
  void postEventPush(game, config, body).catch((err) => {
    console.warn(
      `Event push for game ${game.id} to ${config.url.trim()} failed: ${describeFetchError(err)}`,
    );
  });
}

async function postEventPush(
  game: IGame,
  config: EventPushConfig,
  body: string,
): Promise<void> {
  console.debug({ body });

  const response = await fetch(config.url.trim(), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  const responseBody = await response.text().catch(() => '');
  if (!response.ok) {
    console.warn(
      `Event push for game ${game.id} to ${config.url.trim()} failed with status ${response.status}: ${clip(responseBody)}`,
    );
  }
}

/** The error text, including Node's wrapped `cause` (connection refused, DNS, timeout). */
function describeFetchError(err: unknown): string {
  const parts: Array<string> = [];
  let current: unknown = err;
  for (let depth = 0; current !== undefined && depth < 4; depth++) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const code =
      'code' in current && current.code !== undefined ?
        ` (${String(current.code)})` :
        '';
    parts.push(`${current.message}${code}`);
    current = current.cause;
  }
  return parts.join(': ');
}

function clip(text: string): string {
  const limit = 2000;
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}…`;
}

function eventPushPlayers(game: IGame): Array<EventPushPlayer> {
  return game.playersInGenerationOrder.map((player) => ({
    name: player.name,
    link: playerLink(player.id),
    color: player.color,
  }));
}

function gameStartedValues(game: IGame): Record<string, string> {
  const players = game.playersInGenerationOrder;
  return {
    ...sharedValues(game),
    playerNames: players.map((player) => player.name).join(', '),
    playerSummary: players
      .map((player) => `${player.name} (${playerLink(player.id)})`)
      .join(', '),
  };
}

function waitingForPlayerValues(
  game: IGame,
  player: IPlayer,
): Record<string, string> {
  return {
    ...sharedValues(game),
    playerName: player.name,
    playerColor: player.color,
    playerLink: playerLink(player.id),
  };
}

function sharedValues(game: IGame): Record<string, string> {
  return {
    gameId: game.id,
    gameName: game.name,
    generation: String(game.generation),
    phase: game.phase,
    playerCount: String(game.players.length),
    spectatorLink: spectatorLink(game.spectatorId),
  };
}

function playerLink(playerId: string): string {
  return participantLink(paths.PLAYER, playerId);
}

function spectatorLink(spectatorId: string): string {
  return participantLink(paths.SPECTATOR, spectatorId);
}

function participantLink(path: string, id: string): string {
  const root = URL_ROOT.endsWith('/') ? URL_ROOT.slice(0, -1) : URL_ROOT;
  return `${root}/${path}?id=${encodeURIComponent(id)}`;
}
