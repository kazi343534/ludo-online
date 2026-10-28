import assert from 'node:assert/strict';
import { Game } from '../game/Game.js';
import { MAIN_LOOP, START_INDEX, SAFE_LOOP, HOME_PATHS, BASE, PATH_END } from '../public/js/constants.js';

function makeGame() {
  return new Game([
    { id: 'red-player', name: 'Red', color: 'red' },
    { id: 'green-player', name: 'Green', color: 'green' }
  ]);
}

function forcePending(game, playerId, value, moves) {
  game.dice = value;
  game.diceSeq += 1;
  game.diceRolled = true;
  game.availableMoves = moves;
}

assert.equal(MAIN_LOOP.length, 52, 'main loop must have 52 cells');
assert.equal(new Set(MAIN_LOOP.map((c) => c.join(','))).size, 52, 'loop cells must be unique');
assert.equal(SAFE_LOOP.size, 8, 'must have 8 safe track cells');

for (const color of Object.keys(START_INDEX)) {
  const [c, r] = MAIN_LOOP[START_INDEX[color]];
  assert.ok(c >= 0 && c < 15 && r >= 0 && r < 15, `${color} start inside board`);
  assert.equal(HOME_PATHS[color].length, 6, `${color} home path length`);
}

{
  const game = makeGame();
  assert.deepEqual(game.tokens['red-player'], [BASE, BASE, BASE, BASE]);
  assert.equal(game.roll('green-player', 6).error, 'Not your turn');
  const result = game.roll('red-player', 3);
  assert.deepEqual(result.moves, [], 'no moves without a 6 while all tokens in base');
  game.advanceTurn();
  game.advanceTurn();
  const six = game.roll('red-player', 6);
  assert.deepEqual(six.moves, [0, 1, 2, 3], 'a 6 can bring any base token out');
  const move = game.applyMove('red-player', 0);
  assert.equal(game.tokens['red-player'][0], 0, 'token leaves base to start square');
  assert.equal(move.entered, true, 'leaving base is flagged as an entry');
  assert.equal(move.extraTurn, true, 'rolling 6 grants an extra turn');
  assert.equal(game.currentPlayerId, 'red-player');
  assert.equal(game.captures['red-player'], 0);
  assert.equal(game.snapshot().captures['red-player'], 0);
}

{
  const game = makeGame();
  game.roll('red-player', 6);
  game.applyMove('red-player', 0);
  forcePending(game, 'red-player', 2, [0]);
  game.applyMove('red-player', 0);
  assert.equal(game.tokens['red-player'][0], 2);
  assert.equal(game.currentPlayerId, 'green-player', 'turn passes after non-6');
}

{
  const game = makeGame();
  game.tokens['red-player'] = [0, BASE, BASE, BASE];
  game.tokens['green-player'] = [40, BASE, BASE, BASE];
  forcePending(game, 'red-player', 1, [0]);
  const result = game.applyMove('red-player', 0);
  assert.equal(game.tokens['red-player'][0], 1);
  assert.equal(game.tokens['green-player'][0], BASE, 'opponent token captured and sent home');
  assert.equal(result.captured.length, 1);
  assert.equal(result.entered, false);
  assert.equal(result.extraTurn, true, 'capture grants an extra turn');
  assert.equal(game.captures['red-player'], 1, 'capture counter increments');
  assert.equal(game.captures['green-player'], 0);
  assert.equal(game.snapshot().captures['red-player'], 1);
}

{
  const game = makeGame();
  game.tokens['red-player'] = [7, BASE, BASE, BASE];
  game.tokens['green-player'] = [47, BASE, BASE, BASE];
  forcePending(game, 'red-player', 1, [0]);
  const result = game.applyMove('red-player', 0);
  assert.equal(game.tokens['red-player'][0], 8);
  assert.equal(game.tokens['green-player'][0], 47, 'safe square prevents capture');
  assert.equal(result.captured.length, 0);
  assert.equal(result.extraTurn, false);
}

{
  const game = makeGame();
  game.tokens['red-player'] = [55, BASE, BASE, BASE];
  const blocked = game.roll('red-player', 2);
  assert.deepEqual(blocked.moves, [], 'cannot overshoot home');
  game.advanceTurn();
  game.advanceTurn();
  forcePending(game, 'red-player', 1, [0]);
  game.applyMove('red-player', 0);
  assert.equal(game.tokens['red-player'][0], PATH_END, 'exact roll reaches home');
}

{
  const game = makeGame();
  game.tokens['red-player'] = [PATH_END, PATH_END, PATH_END, 55];
  forcePending(game, 'red-player', 1, [3]);
  const result = game.applyMove('red-player', 3);
  assert.equal(result.finished, true);
  assert.equal(result.winnerId, 'red-player');
  assert.equal(game.finished, true);
}

{
  const game = makeGame();
  game.roll('red-player', 6);
  game.applyMove('red-player', 0);
  game.roll('red-player', 6);
  game.applyMove('red-player', 0);
  const third = game.roll('red-player', 6);
  assert.equal(third.forfeit, true, 'three consecutive sixes forfeit the turn');
  assert.deepEqual(third.moves, []);
}

console.log('engine tests passed');
