import {expect} from 'chai';
import {Game} from '../../../src/server/Game';
import {Server} from '../../../src/server/models/ServerModel';
import {SelectOption} from '../../../src/server/inputs/SelectOption';
import {DEFAULT_URL_ROOT} from '../../../src/common/constants';
import {DEFAULT_GAME_ENDED_BODY, DEFAULT_GAME_STARTED_BODY, DEFAULT_WAITING_FOR_PLAYER_BODY, EventPushConfig} from '../../../src/common/game/EventPush';
import {notifyGameCreated, notifyGameEnded, notifyNewWaits, playersWithRequiredInput} from '../../../src/server/game/EventPush';
import {testGame} from '../../TestGame';

type Call = {
  url: string,
  init: {
    method?: string,
    redirect?: string,
    headers?: Record<string, string>,
    body?: string,
  },
};

describe('EventPush', () => {
  let calls: Array<Call>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    calls = [];
    originalFetch = global.fetch;
    global.fetch = (async (url: unknown, init?: {method?: string, redirect?: string, headers?: Record<string, string>, body?: unknown}) => {
      calls.push({
        url: String(url),
        init: {
          method: init?.method,
          redirect: init?.redirect,
          headers: init?.headers,
          body: typeof init?.body === 'string' ? init.body : undefined,
        },
      });
      return new Response('ok', {status: 200});
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function config(waitingBody = DEFAULT_WAITING_FOR_PLAYER_BODY): EventPushConfig {
    return {
      url: 'https://example.com/hook',
      token: 'secret-token',
      gameStarted: {enabled: true, body: DEFAULT_GAME_STARTED_BODY},
      waitingForPlayer: {enabled: true, body: waitingBody},
    };
  }

  it('posts game started with player names and links', async () => {
    const [game, player1, player2] = testGame(2);
    game.eventPush = config();
    player1.clearWaitingFor();
    player2.clearWaitingFor();

    notifyGameCreated(game);
    await flush();

    expect(calls).length(1);
    expect(calls[0].url).eq('https://example.com/hook');
    expect(calls[0].init.method).eq('POST');
    expect(calls[0].init.redirect).eq('error');
    expect(calls[0].init.headers).deep.eq({
      'Authorization': 'Bearer secret-token',
      'Content-Type': 'application/json',
    });
    const text = JSON.parse(String(calls[0].init.body)).text as string;
    expect(text).to.contain(game.name);
    expect(text).to.contain('player1');
    expect(text).to.contain('player2');
    expect(text).to.contain(`/player?id=${player1.id}`);
    expect(text).to.contain(`/spectator?id=${game.spectatorId}`);
    expect(text).to.not.contain('secret-token');
  });

  it('posts game ended with the winner, standings, and results link', async () => {
    const [game, player] = testGame(1);
    const push = config();
    push.gameEnded = {enabled: true, body: DEFAULT_GAME_ENDED_BODY};
    game.eventPush = push;

    notifyGameEnded(game);
    await flush();

    const root = DEFAULT_URL_ROOT.endsWith('/') ? DEFAULT_URL_ROOT.slice(0, -1) : DEFAULT_URL_ROOT;
    const text = JSON.parse(String(calls[0].init.body)).text as string;
    expect(text).to.contain(`${player.name} lost`);
    expect(text).to.contain(`- [${player.name}](${root}/player?id=${encodeURIComponent(player.id)})`);
    expect(text).to.contain(' VP');
    expect(text).to.contain(`Results: ${root}/the-end?id=${encodeURIComponent(game.spectatorId)}`);
    expect(text).to.not.contain('secret-token');
  });

  it('names every tied winner', async () => {
    const [game, player1, player2] = testGame(2);
    const push = config();
    push.gameEnded = {enabled: true, body: DEFAULT_GAME_ENDED_BODY};
    game.eventPush = push;

    notifyGameEnded(game);
    await flush();

    const text = JSON.parse(String(calls[0].init.body)).text as string;
    expect(text).to.contain(`${player1.name} and ${player2.name} won`);
    expect(text).to.contain(`- [${player1.name}](`);
    expect(text).to.contain(`- [${player2.name}](`);
  });

  it('does not post game ended when that event is missing', async () => {
    const [game] = testGame(1);
    game.eventPush = config();

    notifyGameEnded(game);
    await flush();

    expect(calls).length(0);
  });

  it('posts each player as a markdown link', async () => {
    const [game, player1, player2] = testGame(2);
    const push = config();
    push.gameStarted.body = '{ "text": "{{gameName}} started with {{playerCount}} players:\\n{{#players}}- [{{name}}]({{link}})\\n{{/players}}- [Spectator]({{spectatorLink}})" }';
    game.eventPush = push;
    player1.clearWaitingFor();
    player2.clearWaitingFor();

    notifyGameCreated(game);
    await flush();

    const root = DEFAULT_URL_ROOT.endsWith('/') ? DEFAULT_URL_ROOT.slice(0, -1) : DEFAULT_URL_ROOT;
    const lines = game.playersInGenerationOrder.map((player) => {
      return `- [${player.name}](${root}/player?id=${encodeURIComponent(player.id)})`;
    });
    const text = JSON.parse(String(calls[0].init.body)).text as string;
    expect(text).eq(
      `${game.name} started with 2 players:\n` +
      `${lines.join('\n')}\n` +
      `- [Spectator](${root}/spectator?id=${encodeURIComponent(game.spectatorId)})`,
    );
  });

  it('posts when a player newly has a required input, and not for the next prompt in that turn', async () => {
    const [game, player1, player2] = testGame(2);
    game.eventPush = config('{ "text": "Waiting for player {{playerName}}" }');
    player1.clearWaitingFor();
    player2.clearWaitingFor();

    const nobody = playersWithRequiredInput(game);
    player1.setWaitingFor(new SelectOption('Take action'));
    notifyNewWaits(game, nobody);
    await flush();

    expect(calls.map((call) => JSON.parse(String(call.init.body)).text)).deep.eq(['Waiting for player player1']);

    calls.length = 0;
    const duringTurn = playersWithRequiredInput(game);
    player1.clearWaitingFor();
    player1.setWaitingFor(new SelectOption('Place a tile'));
    notifyNewWaits(game, duringTurn);
    await flush();
    expect(calls).length(0);

    player2.setWaitingFor(new SelectOption('Respond'));
    notifyNewWaits(game, duringTurn);
    await flush();
    expect(calls.map((call) => JSON.parse(String(call.init.body)).text)).deep.eq(['Waiting for player player2']);
  });

  it('does not post for an optional input', async () => {
    const [game, player] = testGame(1);
    game.eventPush = config();
    player.clearWaitingFor();
    const optional = new SelectOption('Skip');
    optional.optional = true;
    player.setWaitingFor(optional);

    notifyNewWaits(game, new Set());
    await flush();
    expect(calls).length(0);
  });

  it('keeps the token on the saved game and out of the client model', () => {
    const [game, player] = testGame(1);
    game.eventPush = config();

    const restored = Game.deserialize(game.serialize());
    expect(restored.eventPush?.token).eq('secret-token');
    expect(JSON.stringify(Server.getSimpleGameModel(restored))).to.not.contain('secret-token');
    expect(JSON.stringify(Server.getPlayerModel(restored.getPlayerById(player.id)))).to.not.contain('secret-token');
  });

  it('logs a failed delivery without throwing', async () => {
    const [game] = testGame(1);
    game.eventPush = config();
    for (const player of game.players) {
      player.clearWaitingFor();
    }
    const warnings: Array<unknown> = [];
    const originalWarn = console.warn;
    console.warn = (message: unknown) => warnings.push(message);
    global.fetch = (() => {
      throw new Error('down');
    }) as typeof fetch;

    try {
      notifyGameCreated(game);
      await flush();
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings.join('\n')).to.contain('failed');
  });

  it('logs the status and response body when the receiver rejects the event', async () => {
    const [game] = testGame(1);
    game.eventPush = config();
    for (const player of game.players) {
      player.clearWaitingFor();
    }
    global.fetch = (async () => new Response('nope: bad token', {status: 401})) as typeof fetch;
    const warnings: Array<unknown> = [];
    const originalWarn = console.warn;
    console.warn = (message: unknown) => warnings.push(message);

    try {
      notifyGameCreated(game);
      await flush();
    } finally {
      console.warn = originalWarn;
    }

    const logged = warnings.join('\n');
    expect(logged).to.contain('status 401');
    expect(logged).to.contain('nope: bad token');
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
