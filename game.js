// Delve game rules. Pure logic, no networking, so it can be tested on its own.

const TARGET_GOLD = 50;
const START_HEALTH = 8;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

const CARDS = {
  copper:     { name: 'Copper Coins',   type: 'treasure', count: 12, gold: 1,  icon: '🪙', text: '+1 gold' },
  gem:        { name: 'Gem',            type: 'treasure', count: 9,  gold: 3,  icon: '💎', text: '+3 gold' },
  chest:      { name: 'Treasure Chest', type: 'treasure', count: 4,  gold: 5,  icon: '🧰', text: '+5 gold' },
  crown:      { name: "Dragon's Crown", type: 'treasure', count: 1,  gold: 10, icon: '👑', text: '+10 gold' },
  rat:        { name: 'Rat',            type: 'monster',  count: 5,  dmg: 1,   icon: '🐀', text: '1 damage' },
  goblin:     { name: 'Goblin',         type: 'monster',  count: 5,  dmg: 2,   icon: '👺', text: '2 damage' },
  skeleton:   { name: 'Skeleton',       type: 'monster',  count: 4,  dmg: 3,   icon: '💀', text: '3 damage' },
  troll:      { name: 'Troll',          type: 'monster',  count: 2,  dmg: 4,   icon: '🧌', text: '4 damage' },
  dragon:     { name: 'Dragon',         type: 'monster',  count: 1,  dmg: 6,   icon: '🐉', text: '6 damage' },
  potion:     { name: 'Potion',         type: 'special',  count: 3,  icon: '🧪', text: 'Heal 3 damage this turn' },
  torch:      { name: 'Torch',          type: 'special',  count: 3,  icon: '🔦', text: 'See the next card before deciding' },
  trap:       { name: 'Trap',           type: 'special',  count: 3,  icon: '🪤', text: 'Lose half your haul (rounded down)' },
  shield:     { name: 'Shield',         type: 'special',  count: 2,  icon: '🛡️', text: 'Block the next monster this turn' },
  mimic:      { name: 'Mimic',          type: 'special',  count: 2,  dmg: 3,   icon: '👅', text: 'Looks like a Treasure Chest, then bites for 3 damage' },
  pickpocket: { name: 'Pickpocket',     type: 'special',  count: 2,  steal: 3, icon: '🫳', text: 'Steal 3 banked gold from the leader' },
  curse:      { name: 'Curse',          type: 'special',  count: 2,  icon: '🕯️', text: 'The next player starts with 2 damage' },
  ambush:     { name: 'Ambush',         type: 'special',  count: 2,  icon: '🏹', text: 'Choose another player: they skip their next turn' },
};

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(rng) {
  const deck = [];
  let n = 0;
  for (const [key, def] of Object.entries(CARDS)) {
    for (let i = 0; i < def.count; i++) deck.push({ id: n++, key });
  }
  return shuffle(deck, rng);
}

class Game {
  constructor(players, rng = Math.random) {
    // players: [{ id, name }]
    this.rng = rng;
    this.players = shuffle(players.map(p => ({
      id: p.id, name: p.name, banked: 0, bestEscape: 0, skipNext: false,
    })), rng);
    this.deck = buildDeck(rng);
    this.discard = [];
    this.turnIdx = 0;
    this.round = 1;
    this.pendingCurse = false;
    this.finalRound = false;
    this.over = false;
    this.winners = [];
    this.log = [];
    this.turn = null;
    this.lastTurn = null;
    this.beginTurn();
  }

  addLog(text) {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
  }

  get current() { return this.players[this.turnIdx]; }
  player(id) { return this.players.find(p => p.id === id); }

  draw() {
    if (this.deck.length === 0) {
      this.deck = this.discard.length ? shuffle(this.discard, this.rng) : buildDeck(this.rng);
      this.discard = [];
      this.addLog('The dungeon deck was reshuffled.');
    }
    return this.deck.pop();
  }

  peekTop() {
    if (this.deck.length === 0) {
      this.deck = this.discard.length ? shuffle(this.discard, this.rng) : buildDeck(this.rng);
      this.discard = [];
      this.addLog('The dungeon deck was reshuffled.');
    }
    return this.deck[this.deck.length - 1];
  }

  beginTurn() {
    // Skipped players lose this turn but it still counts toward the round.
    let guard = 0;
    while (this.current.skipNext && guard++ < this.players.length) {
      this.current.skipNext = false;
      this.addLog(`${this.current.name} was ambushed and skips this turn.`);
      if (this.advanceSeat()) return;
    }
    const cursed = this.pendingCurse;
    this.pendingCurse = false;
    this.turn = {
      playerId: this.current.id,
      damage: cursed ? 2 : 0,
      haul: 0,
      shield: false,
      flipped: [],      // [{ id, key, note }]
      peek: null,       // card seen with a Torch (only shown to the current player)
      choosingAmbush: false,
      cursed,
    };
    if (cursed) this.addLog(`${this.current.name} starts cursed with 2 damage.`);
  }

  // Moves to the next seat. Returns true if the game ended.
  advanceSeat() {
    this.turnIdx++;
    if (this.turnIdx >= this.players.length) {
      this.turnIdx = 0;
      if (this.finalRound) {
        this.finish();
        return true;
      }
      this.round++;
    }
    return false;
  }

  endTurn(result) {
    const t = this.turn;
    this.discard.push(...t.flipped.map(c => ({ id: c.id, key: c.key })));
    this.lastTurn = { playerId: t.playerId, name: this.current.name, flipped: t.flipped, haul: t.haul, damage: t.damage, result };
    this.turn = null;
    if (this.advanceSeat()) return;
    this.beginTurn();
  }

  finish() {
    this.over = true;
    this.turn = null;
    const top = Math.max(...this.players.map(p => p.banked));
    this.winners = this.players.filter(p => p.banked === top).map(p => p.id);
    const names = this.players.filter(p => this.winners.includes(p.id)).map(p => p.name);
    this.addLog(names.length > 1 ? `${names.join(' and ')} share the win with ${top} gold!` : `${names[0]} wins with ${top} gold!`);
  }

  // Leader among the other players. Null if the thief is already the leader or nobody has gold.
  leaderFor(thiefId) {
    const thief = this.player(thiefId);
    const others = this.players.filter(p => p.id !== thiefId);
    const top = Math.max(...others.map(p => p.banked));
    if (top <= 0 || thief.banked >= top) return null;
    return others.find(p => p.banked === top);
  }

  // Actions return an error string, or null on success.
  delve(playerId) {
    if (this.over) return 'The game is over.';
    const t = this.turn;
    if (!t || t.playerId !== playerId) return "It's not your turn.";
    if (t.choosingAmbush) return 'Choose who to ambush first.';
    const me = this.current;
    const card = this.draw();
    const def = CARDS[card.key];
    const flip = { id: card.id, key: card.key, note: '' };
    t.flipped.push(flip);
    t.peek = null;

    if (def.type === 'treasure') {
      t.haul += def.gold;
      flip.note = `+${def.gold} gold`;
    } else if (def.type === 'monster' || card.key === 'mimic') {
      if (t.shield) {
        t.shield = false;
        flip.note = 'Blocked by your shield!';
        this.addLog(`${me.name}'s shield blocked a ${def.name}.`);
      } else {
        t.damage += def.dmg;
        flip.note = card.key === 'mimic' ? `It was a Mimic! ${def.dmg} damage` : `${def.dmg} damage`;
      }
    } else if (card.key === 'potion') {
      const healed = Math.min(3, t.damage);
      t.damage -= healed;
      flip.note = healed ? `Healed ${healed}` : 'Nothing to heal';
    } else if (card.key === 'torch') {
      t.peek = this.peekTop();
      flip.note = 'You can see the next card';
    } else if (card.key === 'trap') {
      const lost = Math.floor(t.haul / 2);
      t.haul -= lost;
      flip.note = lost ? `Lost ${lost} gold` : 'Nothing to lose';
      if (lost) this.addLog(`${me.name} hit a trap and lost ${lost} gold.`);
    } else if (card.key === 'shield') {
      t.shield = true;
      flip.note = 'Next monster is blocked';
    } else if (card.key === 'pickpocket') {
      const victim = this.leaderFor(playerId);
      if (victim) {
        const amount = Math.min(def.steal, victim.banked);
        victim.banked -= amount;
        me.banked += amount;
        flip.note = `Stole ${amount} from ${victim.name}`;
        this.addLog(`${me.name} pickpocketed ${amount} gold from ${victim.name}.`);
        this.checkFinalRound(me);
      } else {
        flip.note = "You're the leader, nobody to rob";
      }
    } else if (card.key === 'curse') {
      this.pendingCurse = true;
      flip.note = 'Next player starts with 2 damage';
      this.addLog(`${me.name} cursed the next player.`);
    } else if (card.key === 'ambush') {
      t.choosingAmbush = true;
      flip.note = 'Choose a player to skip their next turn';
    }

    if (t.damage >= START_HEALTH) {
      this.addLog(`${me.name} was overwhelmed and lost ${t.haul} gold.`);
      this.endTurn('bust');
    }
    return null;
  }

  ambush(playerId, targetId) {
    const t = this.turn;
    if (!t || t.playerId !== playerId || !t.choosingAmbush) return 'No ambush to play.';
    const target = this.player(targetId);
    if (!target || targetId === playerId) return 'Pick another player.';
    target.skipNext = true;
    t.choosingAmbush = false;
    const flip = t.flipped[t.flipped.length - 1];
    flip.note = `${target.name} skips their next turn`;
    this.addLog(`${this.current.name} ambushed ${target.name}.`);
    return null;
  }

  escape(playerId) {
    if (this.over) return 'The game is over.';
    const t = this.turn;
    if (!t || t.playerId !== playerId) return "It's not your turn.";
    if (t.choosingAmbush) return 'Choose who to ambush first.';
    if (t.flipped.length === 0) return 'Flip at least one card before escaping.';
    const me = this.current;
    me.banked += t.haul;
    me.bestEscape = Math.max(me.bestEscape, t.haul);
    this.addLog(`${me.name} escaped with ${t.haul} gold.`);
    this.checkFinalRound(me);
    this.endTurn('escape');
    return null;
  }

  // Used when the current player has lost connection and the host moves the game on.
  forceSkip() {
    if (this.over || !this.turn) return 'Nothing to skip.';
    const t = this.turn;
    if (t.choosingAmbush) t.choosingAmbush = false;
    this.addLog(`${this.current.name}'s turn was skipped (disconnected). Their haul of ${t.haul} was lost.`);
    this.endTurn('skipped');
    return null;
  }

  checkFinalRound(p) {
    if (!this.finalRound && p.banked >= TARGET_GOLD) {
      this.finalRound = true;
      this.addLog(`${p.name} reached ${TARGET_GOLD} gold! Final round: everyone finishes this round.`);
    }
  }

  // What one player is allowed to see.
  view(forId) {
    const t = this.turn;
    return {
      players: this.players.map(p => ({
        id: p.id, name: p.name, banked: p.banked, bestEscape: p.bestEscape, skipNext: p.skipNext,
      })),
      turnPlayerId: t ? t.playerId : null,
      turn: t ? {
        damage: t.damage, haul: t.haul, shield: t.shield, cursed: t.cursed,
        flipped: t.flipped, choosingAmbush: t.choosingAmbush,
        peek: t.peek && t.playerId === forId ? { key: t.peek.key === 'mimic' ? 'chest' : t.peek.key } : null,
        peeking: !!t.peek,
      } : null,
      lastTurn: this.lastTurn || null,
      deckCount: this.deck.length,
      round: this.round,
      finalRound: this.finalRound,
      over: this.over,
      winners: this.winners,
      log: this.log.slice(-8),
    };
  }
}

module.exports = { Game, CARDS, TARGET_GOLD, START_HEALTH, MAX_PLAYERS, MIN_PLAYERS, buildDeck };
