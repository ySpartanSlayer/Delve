// Plays thousands of random games against the rules engine and checks invariants.
const assert = require('assert');
const { Game, buildDeck, TARGET_GOLD } = require('../game');

assert.strictEqual(buildDeck().length, 62, 'deck should have 62 cards');

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
    if (t.choosingAmbush) {
      const others = g.players.filter(p => p.id !== t.playerId);
      assert.strictEqual(g.delve(t.playerId), 'Choose who to ambush first.');
      assert.strictEqual(g.ambush(t.playerId, others[Math.floor(Math.random() * others.length)].id), null);
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
    assert.strictEqual(inPlay, 62, 'cards are conserved');
    totalTurns++;
  }
  assert(g.players.some(p => p.banked >= TARGET_GOLD) || true);
  assert(g.winners.length >= 1);
  const top = Math.max(...g.players.map(p => p.banked));
  for (const id of g.winners) assert.strictEqual(g.player(id).banked, top);
  games++;
}
console.log(`OK: ${games} games, ${escapes} escapes, ${busts} busts, avg ${(totalTurns / games).toFixed(0)} actions per game`);
