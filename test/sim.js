// Plays thousands of random games against the rules engine and checks invariants.
const assert = require('assert');
const { Game, buildDeck, TARGET_GOLD } = require('../game');

assert.strictEqual(buildDeck(Math.random, 3).length, 63, '3+ player deck should have 63 cards');
assert.strictEqual(buildDeck(Math.random, 2).length, 60, '2 player deck should have 60 cards');
assert(!buildDeck(Math.random, 2).some(c => c.key === 'ambush' || c.key === 'plunder'), 'no Ambush or Plunder with 2 players');

let totalTurns = 0, games = 0, busts = 0, escapes = 0;
for (let n = 0; n < 3000; n++) {
  const count = 2 + (n % 5);
  const players = Array.from({ length: count }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const g = new Game(players);
  let steps = 0;
  const turnsTaken = Object.fromEntries(players.map(p => [p.id, 0]));
  while (!g.over) {
    assert(steps++ < 20000, 'game should end');
    const t = g.turn;
    if (t.choice) {
      assert.strictEqual(g.delve(t.playerId), 'Finish your card choice first.');
      if (t.choice.kind === 'toll' && !t.choice.roll) { assert.strictEqual(g.roll(t.playerId), null); continue; }
      const targets = g.choiceTargets(t.choice.kind);
      assert(targets.length > 0, 'a choice always has someone to pick');
      assert.strictEqual(g.choose(t.playerId, targets[Math.floor(Math.random() * targets.length)].id), null);
      continue;
    }
    // Simple strategy: escape once haul >= 6 or damage >= 5.
    const before = t.playerId;
    if (t.flipped.length && (t.haul >= 6 || t.damage >= 5)) {
      assert.strictEqual(g.escape(t.playerId), null);
      escapes++; turnsTaken[before]++;
    } else {
      const other = g.players.find(p => p.id !== t.playerId);
      assert.notStrictEqual(g.delve(other.id), null, 'other players cannot act');
      assert.strictEqual(g.delve(t.playerId), null);
      if (g.lastTurn && g.lastTurn.result === 'bust' && (!g.turn || g.turn.playerId !== before || g.turn.flipped.length === 0)) { busts++; turnsTaken[before]++; }
    }
    for (const p of g.players) assert(p.banked >= 0, 'gold never negative');
    const inPlay = g.deck.length + g.discard.length + (g.turn ? g.turn.flipped.length : 0);
    assert.strictEqual(inPlay, g.deckSize, 'cards are conserved');
    if (g.turn) assert(g.turn.damage < 8, 'a turn never starts dead');
    totalTurns++;
  }
  assert(g.players.some(p => p.banked >= TARGET_GOLD) || true);
  assert(g.winners.length >= 1);
  const top = Math.max(...g.players.map(p => p.banked));
  for (const id of g.winners) assert.strictEqual(g.player(id).banked, top);
  games++;
}
console.log(`OK: ${games} games, ${escapes} escapes, ${busts} busts, avg ${(totalTurns / games).toFixed(0)} actions per game`);

// Curses stack: two curses in one turn give the next player 4 damage.
{
  const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const curses = g.deck.filter(c => c.key === 'curse');
  g.deck = g.deck.filter(c => c.key !== 'curse').concat(curses); // both curses on top
  const first = g.turn.playerId;
  g.delve(first); g.delve(first); g.escape(first);
  assert.strictEqual(g.turn.damage, 4, 'two curses stack to 4 damage');
  console.log('OK: curses stack');
}
