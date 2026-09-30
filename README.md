# Skribbl.io Clone

Multiplayer drawing & guessing game. React + Vite, Node + Express, Socket.IO, HTML5 Canvas.

**Live URL:** https://skribbl-clone-anshikajain.onrender.com <!-- replace after deploying -->

## Run locally
```bash
npm install
npm run dev:server   # terminal 1 -> :3000
npm run dev:client   # terminal 2 -> http://localhost:5173
```
Production mode: `npm run build && npm start` -> http://localhost:3000

## Deploy (Render)
New Web Service -> connect GitHub repo -> Build: `npm install && npm run build` -> Start: `npm start`.

## Architecture
- `server/index.js`: `Player` and `Room` classes (OOP). `Room` holds players, phases (lobby/choosing/drawing/roundEnd/gameover), timer, hints, scoring. Socket handlers only route events to the room.
- `client/src/App.jsx`: Home, Lobby, Game and Board (canvas) components. The server sends one `game_state` event and the UI renders from it.
- Drawing: pointer events on the drawer's canvas are sent as normalized (0..1) coordinates via `draw_start/move/end`. The server stores strokes (for undo and late joiners) and broadcasts `draw_data`.
- Scoring: faster guess = more points; the drawer gets +30 per correct guesser.
- Word matching: trimmed, case-insensitive, exact match. The word is never leaked in chat.
