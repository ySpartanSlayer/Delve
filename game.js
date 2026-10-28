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
  rat:        { name: 'Rat',            type: 'monster',  count: 4,  dmg: 1,   icon: '🐀', text: '1 damage' },
  goblin:     { name: 'Goblin',         type: 'monster',  count: 4,  dmg: 2,   icon: '👺', text: '2 damage' },
  skeleton:   { name: 'Skeleton',       type: 'monster',  count: 3,  dmg: 3,   icon: '💀', text: '3 damage' },
  troll:      { name: 'Troll',          type: 'monster',  count: 2,  dmg: 4,   icon: '🧌', text: '4 damage' },
  dragon:     { name: 'Dragon',         type: 'monster',  count: 1,  dmg: 6,   icon: '🐉', text: '6 damage' },
  potion:     { name: 'Potion',         type: 'special',  count: 3,  icon: '🧪', text: 'Heal 3 damage this turn' },
  torch:      { name: 'Torch',          type: 'special',  count: 3,  icon: '🔦', text: 'See the next card before deciding' },
  trap:       { name: 'Trap',           type: 'special',  count: 3,  icon: '🪤', text: 'Lose half your haul (rounded down)' },
  shield:     { name: 'Shield',         type: 'special',  count: 2,  icon: '🛡️', text: 'Block the next monster this turn' },
  mimic:      { name: 'Mimic',          type: 'special',  count: 2,  dmg: 3,   icon: '👅', text: 'Looks like a Treasure Chest, then bites for 3 damage' },
  pickpocket: { name: 'Pickpocket',     type: 'special',  count: 2,  steal: 3, icon: '🫳', text: 'Steal 3 banked gold from the leader' },
  curse:      { name: 'Curse',          type: 'special',  count: 2,  icon: '🕯️', text: 'The next player starts with +2 damage (curses stack)' },
  toll:       { name: 'Toll',           type: 'special',  count: 2,  icon: '🎲', text: 'Roll a die and pay that much gold to a player you choose' },
  cavein:     { name: 'Cave-in',        type: 'special',  count: 1,  icon: '🪨', text: 'Lose ALL your gold, banked and carried. Your turn ends' },
  ambush:     { name: 'Ambush',         type: 'special',  count: 2,  minPlayers: 3, icon: '🏹', text: 'Choose another player: they skip their next turn (3+ players)' },
  plunder:    { name: 'Plunder',        type: 'special',  count: 1,  minPlayers: 3, icon: '🏴‍☠️', text: "Choose a player and take half their banked gold (3+ players)" },
};

const CURSE_DMG = 2;
const MAX_CURSE = START_HEALTH - 2; // stacked curses never end a turn before it starts

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck(rng, playerCount = MAX_PLAYERS) {
  const deck = [];
  let n = 0;
  for (const [key, def] of Object.entries(CARDS)) {
    if (def.minPlayers && playerCount < def.minPlayers) continue;
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
    this.deck = buildDeck(rng, this.players.length);
    this.deckSize = this.deck.length;
    this.discard = [];
    this.turnIdx = 0;
    this.round = 1;
    this.pendingCurse = 0;
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
      this.deck = this.discard.length ? shuffle(this.discard, this.rng) : buildDeck(this.rng, this.players.length);
      this.discard = [];
      this.addLog('The dungeon deck was reshuffled.');
    }
    return this.deck.pop();
  }

  peekTop() {
    if (this.deck.length === 0) {
      this.deck = this.discard.length ? shuffle(this.discard, this.rng) : buildDeck(this.rng, this.players.length);
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
    const cursed = Math.min(this.pendingCurse, MAX_CURSE);
    this.pendingCurse = 0;
    this.turn = {
      playerId: this.current.id,
      damage: cursed,
      haul: 0,
      shield: false,
      flipped: [],      // [{ id, key, note }]
      peek: null,       // card seen with a Torch (only shown to the current player)
      choice: null,     // { kind: 'ambush' | 'plunder' | 'toll', roll } while the player must pick
      cursed,
    };
    if (cursed) this.addLog(`${this.current.name} starts cursed with ${cursed} damage.`);
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
    if (t.choice) return 'Finish your card choice first.';
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
      this.pendingCurse += CURSE_DMG;
      const total = Math.min(this.pendingCurse, MAX_CURSE);
      flip.note = `Next player starts with ${total} damage`;
      this.addLog(`${me.name} cursed the next player (${total} damage waiting).`);
    } else if (card.key === 'cavein') {
      const lost = me.banked + t.haul;
      me.banked = 0;
      t.haul = 0;
      flip.note = lost ? `Lost all ${lost} gold!` : 'Nothing to lose';
      this.addLog(`The cave collapsed on ${me.name}! They lost all ${lost} gold.`);
      this.endTurn('cavein');
      return null;
    } else if (card.key === 'toll') {
      t.choice = { kind: 'toll', roll: null };
      flip.note = 'Roll the die';
    } else if (card.key === 'ambush') {
      if (this.choiceTargets('ambush').length) {
        t.choice = { kind: 'ambush' };
        flip.note = 'Choose a player to skip their next turn';
      } else {
        flip.note = 'Everyone is already ambushed';
      }
    } else if (card.key === 'plunder') {
      if (this.choiceTargets('plunder').length) {
        t.choice = { kind: 'plunder' };
        flip.note = 'Choose a player to plunder';
      } else {
        flip.note = 'Nobody has gold to plunder';
      }
    }

    if (t.damage >= START_HEALTH) {
      this.addLog(`${me.name} was overwhelmed and lost ${t.haul} gold.`);
      this.endTurn('bust');
    }
    return null;
  }

  // Players the current player may pick for a choice card.
  choiceTargets(kind) {
    const others = this.players.filter(p => p.id !== this.current.id);
    if (kind === 'ambush') return others.filter(p => !p.skipNext);
    if (kind === 'plunder') return others.filter(p => p.banked >= 2);
    return others;
  }

  roll(playerId) {
    const t = this.turn;
    if (!t || t.playerId !== playerId || !t.choice || t.choice.kind !== 'toll') return 'No die to roll.';
    if (t.choice.roll) return 'You already rolled.';
    t.choice.roll = 1 + Math.floor(this.rng() * 6);
    const me = this.current;
    const owed = Math.min(t.choice.roll, t.haul + me.banked);
    const flip = t.flipped[t.flipped.length - 1];
    if (owed === 0) {
      flip.note = `Rolled ${t.choice.roll}, but you have no gold to pay`;
      t.choice = null;
    } else {
      flip.note = `Rolled ${t.choice.roll}: choose who gets ${owed} gold`;
    }
    return null;
  }

  choose(playerId, targetId) {
    const t = this.turn;
    if (!t || t.playerId !== playerId || !t.choice) return 'Nothing to choose.';
    const c = t.choice;
    if (c.kind === 'toll' && !c.roll) return 'Roll the die first.';
    const target = this.choiceTargets(c.kind).find(p => p.id === targetId);
    if (!target) return 'Pick another player.';
    const me = this.current;
    const flip = t.flipped[t.flipped.length - 1];
    if (c.kind === 'ambush') {
      target.skipNext = true;
      flip.note = `${target.name} skips their next turn`;
      this.addLog(`${me.name} ambushed ${target.name}.`);
    } else if (c.kind === 'plunder') {
      const amount = Math.floor(target.banked / 2);
      target.banked -= amount;
      me.banked += amount;
      flip.note = `Took ${amount} gold from ${target.name}`;
      this.addLog(`${me.name} plundered ${amount} gold from ${target.name}.`);
      this.checkFinalRound(me);
    } else if (c.kind === 'toll') {
      let owed = Math.min(c.roll, t.haul + me.banked);
      const fromHaul = Math.min(owed, t.haul);
      t.haul -= fromHaul;
      me.banked -= owed - fromHaul;
      target.banked += owed;
      flip.note = `Rolled ${c.roll}: paid ${owed} gold to ${target.name}`;
      this.addLog(`${me.name} rolled a ${c.roll} and paid ${owed} gold to ${target.name}.`);
      this.checkFinalRound(target);
    }
    t.choice = null;
    return null;
  }

  escape(playerId) {
    if (this.over) return 'The game is over.';
    const t = this.turn;
    if (!t || t.playerId !== playerId) return "It's not your turn.";
    if (t.choice) return 'Finish your card choice first.';
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
    t.choice = null;
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
        flipped: t.flipped,
        choice: t.choice ? { kind: t.choice.kind, roll: t.choice.roll || null, targets: this.choiceTargets(t.choice.kind).map(p => p.id) } : null,
        peek: t.peek && t.playerId === forId ? { key: t.peek.key === 'mimic' ? 'chest' : t.peek.key } : null,
        peeking: !!t.peek,
      } : null,
      lastTurn: this.lastTurn || null,
      deckCount: this.deck.length,
      deckSize: this.deckSize,
      round: this.round,
      finalRound: this.finalRound,
      over: this.over,
      winners: this.winners,
      log: this.log.slice(-8),
    };
  }
}

module.exports = { Game, CARDS, TARGET_GOLD, START_HEALTH, MAX_PLAYERS, MIN_PLAYERS, buildDeck };
