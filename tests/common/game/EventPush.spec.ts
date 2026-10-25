import {expect} from 'chai';
import {
  DEFAULT_GAME_STARTED_BODY,
  DEFAULT_WAITING_FOR_PLAYER_BODY,
  EventPushConfig,
  GAME_STARTED_VARIABLES,
  WAITING_FOR_PLAYER_VARIABLES,
  eventPushError,
  renderEventPushBody,
} from '../../../src/common/game/EventPush';

describe('renderEventPushBody', () => {
  const values = {
    gameId: 'g1',
    gameName: 'Remote Carbon Trace',
    generation: '3',
    phase: 'action',
    playerCount: '2',
    spectatorLink: 'http://localhost:8080/spectator?id=s1',
    playerNames: 'Alice, Bob',
    playerSummary: 'Alice (http://localhost:8080/player?id=p1), Bob (http://localhost:8080/player?id=p2)',
    playerName: 'Alice',
    playerColor: 'red',
    playerLink: 'http://localhost:8080/player?id=p1',
  };

  it('substitutes placeholders inside a JSON string', () => {
    const rendered = renderEventPushBody(
      '{ "text": "Waiting for player {{playerName}} at gen {{generation}}" }',
      values,
      WAITING_FOR_PLAYER_VARIABLES,
    );

    expect(JSON.parse(rendered)).deep.eq({text: 'Waiting for player Alice at gen 3'});
  });

  it('escapes quotes and backslashes in a name', () => {
    const rendered = renderEventPushBody(
      '{ "text": "Waiting for player {{playerName}}" }',
      {...values, playerName: 'A"B\\C'},
      WAITING_FOR_PLAYER_VARIABLES,
    );

    expect(JSON.parse(rendered).text).eq('Waiting for player A"B\\C');
  });

  it('inserts playerSummary as text', () => {
    const rendered = renderEventPushBody(DEFAULT_GAME_STARTED_BODY, values, GAME_STARTED_VARIABLES);
    const text = JSON.parse(rendered).text as string;

    expect(text).to.contain('Alice (http://localhost:8080/player?id=p1)');
    expect(text).to.contain('Bob (http://localhost:8080/player?id=p2)');
    expect(text).to.contain('http://localhost:8080/spectator?id=s1');
  });

  it('repeats a player block as markdown lines', () => {
    const players = [
      {name: 'P1', link: 'http://localhost:8080/player?id=p1', color: 'red'},
      {name: 'P2', link: 'http://localhost:8080/player?id=p2', color: 'blue'},
    ];
    const rendered = renderEventPushBody(
      '{ "text": "{{gameName}} started with {{playerCount}} players:\\n{{#players}}- [{{name}}]({{link}})\\n{{/players}}- [Spectator]({{spectatorLink}})" }',
      values,
      GAME_STARTED_VARIABLES,
      players,
    );

    expect(JSON.parse(rendered).text).eq(
      'Remote Carbon Trace started with 2 players:\n' +
      '- [P1](http://localhost:8080/player?id=p1)\n' +
      '- [P2](http://localhost:8080/player?id=p2)\n' +
      '- [Spectator](http://localhost:8080/spectator?id=s1)',
    );
  });

  it('escapes a player name inside the list', () => {
    const rendered = renderEventPushBody(
      '{ "text": "{{#players}}{{name}}{{/players}}" }',
      values,
      GAME_STARTED_VARIABLES,
      [{name: 'A"B\\C', link: 'http://localhost:8080/player?id=p1', color: 'red'}],
    );

    expect(JSON.parse(rendered).text).eq('A"B\\C');
  });

  it('rejects an unknown variable inside the player list', () => {
    expect(() => renderEventPushBody(
      '{ "text": "{{#players}}{{playerName}}{{/players}}" }',
      values,
      GAME_STARTED_VARIABLES,
      [{name: 'P1', link: 'http://localhost:8080/player?id=p1', color: 'red'}],
    )).to.throw(/Unknown variable playerName/);
  });

  it('rejects a player list outside Game started', () => {
    expect(() => renderEventPushBody(
      '{ "text": "{{#players}}{{name}}{{/players}}" }',
      values,
      WAITING_FOR_PLAYER_VARIABLES,
    )).to.throw(/Player lists are only available for Game started/);
  });

  it('rejects an unclosed player list', () => {
    expect(() => renderEventPushBody(
      '{ "text": "{{#players}}{{name}}" }',
      values,
      GAME_STARTED_VARIABLES,
      [],
    )).to.throw(/Unclosed \{\{#players\}\}/);
  });

  it('rejects an unknown variable', () => {
    expect(() => renderEventPushBody('{ "text": "{{playerName}}" }', values, GAME_STARTED_VARIABLES))
      .to.throw(/Unknown variable playerName/);
  });

  it('rejects a body that is not JSON after substitution', () => {
    expect(() => renderEventPushBody('{ "text": {{playerName}} }', values, WAITING_FOR_PLAYER_VARIABLES)).to.throw();
  });
});

describe('eventPushError', () => {
  const config: EventPushConfig = {
    url: 'https://example.com/hook',
    token: 'secret',
    gameStarted: {enabled: true, body: DEFAULT_GAME_STARTED_BODY},
    waitingForPlayer: {enabled: true, body: DEFAULT_WAITING_FOR_PLAYER_BODY},
  };

  it('accepts the default bodies', () => {
    expect(eventPushError(config)).eq(undefined);
  });

  it('accepts a markdown player list', () => {
    expect(eventPushError({
      ...config,
      gameStarted: {
        enabled: true,
        body: '{ "text": "{{gameName}}:\\n{{#players}}- [{{name}}]({{link}})\\n{{/players}}- [Spectator]({{spectatorLink}})" }',
      },
    })).eq(undefined);
  });

  it('accepts http urls', () => {
    expect(eventPushError({...config, url: 'http://localhost:9000/hook'})).eq(undefined);
  });

  it('requires a token and one enabled event', () => {
    expect(eventPushError({...config, token: '  '})).eq('Event push token is required.');
    expect(eventPushError({
      ...config,
      gameStarted: {enabled: false, body: ''},
      waitingForPlayer: {enabled: false, body: ''},
    })).eq('Enable Game started or Waiting for player.');
  });
});
