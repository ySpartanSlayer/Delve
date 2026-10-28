# Delve

A push-your-luck multiplayer dungeon card race for 2 to 6 players. Everyone plays on their own phone or laptop with a 4-letter room code. No login, no install.

## Run it locally

```
npm install
npm start
```

Then open http://localhost:3000.

## Test

```
npm test
```

Plays 3,000 random games against the rules engine and checks that cards are conserved, gold never goes negative, and every game ends with a correct winner.

## Files

- `game.js`: the rules (deck, turns, card effects, winning)
- `server.js`: web server and WebSocket sync; rooms, rejoin, host controls
- `public/`: the phone-friendly web page
- `render.yaml`: one-click deploy to Render's free tier
