import {
  BASE,
  PATH_END,
  MAIN_LOOP,
  START_INDEX,
  SAFE_LOOP
} from '../public/js/constants.js';

export class Game {
  constructor(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.tokens = {};
    this.captures = {};
    for (const p of this.players) {
      this.tokens[p.id] = [BASE, BASE, BASE, BASE];
      this.captures[p.id] = 0;
    }
    this.turnIndex = 0;
    this.dice = null;
    this.diceSeq = 0;
    this.diceRolled = false;
    this.availableMoves = [];
    this.consecutiveSixes = 0;
    this.winnerId = null;
    this.finished = false;
  }

  get currentPlayerId() {
    return this.order[this.turnIndex];
  }

  playerById(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  colorOf(id) {
    const p = this.playerById(id);
    return p ? p.color : null;
  }

  loopIndexOf(playerId, pos) {
    const start = START_INDEX[this.colorOf(playerId)];
    return (start + pos) % MAIN_LOOP.length;
  }

  computeMoves(playerId, value) {
    const tokens = this.tokens[playerId];
    const moves = [];
    tokens.forEach((pos, index) => {
      if (pos === PATH_END) return;
      if (pos === BASE) {
        if (value === 6) moves.push(index);
        return;
      }
      if (pos + value <= PATH_END) moves.push(index);
    });
    return moves;
  }

  roll(playerId, value) {
    if (this.finished) return { error: 'Game is over' };
    if (playerId !== this.currentPlayerId) return { error: 'Not your turn' };
    if (this.diceRolled) return { error: 'Move already pending' };
    if (!Number.isInteger(value) || value < 1 || value > 6) return { error: 'Invalid dice value' };

    this.dice = value;
    this.diceSeq += 1;
    this.diceRolled = true;

    if (value === 6) this.consecutiveSixes += 1;
    else this.consecutiveSixes = 0;

    const forfeit = this.consecutiveSixes >= 3;
    this.availableMoves = forfeit ? [] : this.computeMoves(playerId, value);

    return { dice: value, moves: this.availableMoves, forfeit };
  }

  applyMove(playerId, tokenIndex) {
    if (this.finished) return { error: 'Game is over' };
    if (playerId !== this.currentPlayerId) return { error: 'Not your turn' };
    if (!this.diceRolled) return { error: 'Roll the dice first' };
    if (!Number.isInteger(tokenIndex) || !this.availableMoves.includes(tokenIndex)) {
      return { error: 'Invalid move' };
    }

    const value = this.dice;
    const tokens = this.tokens[playerId];
    const captured = [];
    const entered = tokens[tokenIndex] === BASE;

    if (tokens[tokenIndex] === BASE) {
      tokens[tokenIndex] = 0;
    } else {
      const target = tokens[tokenIndex] + value;
      tokens[tokenIndex] = target;
      if (target <= 50) {
        const loop = this.loopIndexOf(playerId, target);
        if (!SAFE_LOOP.has(loop)) {
          for (const opp of this.players) {
            if (opp.id === playerId) continue;
            const oppTokens = this.tokens[opp.id];
            for (let i = 0; i < oppTokens.length; i += 1) {
              const pos = oppTokens[i];
              if (pos >= 0 && pos <= 50 && this.loopIndexOf(opp.id, pos) === loop) {
                oppTokens[i] = BASE;
                captured.push({ playerId: opp.id, tokenIndex: i });
              }
            }
          }
        }
      }
    }

    if (captured.length > 0) this.captures[playerId] += captured.length;

    this.diceRolled = false;
    this.availableMoves = [];

    const allHome = this.tokens[playerId].every((pos) => pos === PATH_END);
    if (allHome) {
      this.finished = true;
      this.winnerId = playerId;
    }

    let extraTurn = false;
    if (!this.finished) {
      extraTurn = value === 6 || captured.length > 0;
      if (!extraTurn) {
        this.advanceTurn();
      } else if (value !== 6) {
        this.consecutiveSixes = 0;
      }
    }

    return {
      captured,
      entered,
      extraTurn,
      finished: this.finished,
      winnerId: this.winnerId,
      nextPlayerId: this.finished ? null : this.currentPlayerId
    };
  }

  advanceTurn() {
    this.turnIndex = (this.turnIndex + 1) % this.order.length;
    this.consecutiveSixes = 0;
    this.diceRolled = false;
    this.availableMoves = [];
    return this.currentPlayerId;
  }

  snapshot() {
    return {
      turnPlayerId: this.currentPlayerId,
      dice: this.dice,
      diceSeq: this.diceSeq,
      diceRolled: this.diceRolled,
      pendingMoves: [...this.availableMoves],
      tokens: this.tokens,
      captures: this.captures,
      winnerId: this.winnerId,
      finished: this.finished
    };
  }
}
