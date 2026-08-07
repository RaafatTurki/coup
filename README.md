# Coup

Starter fullstack project for an online game of Coup using SvelteKit + TypeScript.

## Included

- SvelteKit frontend with lobby and game table views
- In-memory server game engine for Coup-like turns and actions
- API endpoints for create/join/start/action flows
- WebSocket-based live updates on the game page

## Game Flow

- Create a game from `/`
- Share the 6-character game ID
- Other players join the table
- Host starts the game
- Players take turns with these actions:
  - `income`, `foreign_aid`, `tax`, `steal`, `assassinate`, `coup`, `exchange`

Rules implemented:

- Action challenges for claim-based actions (`tax`, `steal`, `assassinate`, `exchange`)
- Blocking flow (`foreign_aid`, `steal`, `assassinate`) with block challenges
- Manual influence reveal choices when a player loses influence
- Ambassador exchange flow (draw 2, choose cards to keep, return/shuffle remainder)
- Automatic host transfer when the host disconnects
- Manual host transfer and host kick controls from the game table UI
- Player connection + device indicators in the player list

## API Endpoints

- `POST /api/games` create game `{ name }`
- `GET /api/games/:gameId?playerId=...` get public game state
- `POST /api/games/:gameId/join` join game `{ name }`
- `POST /api/games/:gameId/start` host starts game `{ playerId }`
- `POST /api/games/:gameId/action` submit command `{ playerId, command }`
- `POST /api/games/:gameId/host` transfer host `{ playerId, targetId }`
- `POST /api/games/:gameId/kick` kick a player `{ playerId, targetId }`

## Run

```bash
bun install
bun run dev
```

Optional realtime config:

```bash
# websocket server + client port for local development (defaults to 24678)
COUP_WS_PORT=24678 VITE_COUP_WS_PORT=24678 bun run dev

# or point the client at a full websocket URL
VITE_COUP_WS_URL=wss://coup.example.com:24678 bun run build
```

Type checks:

```bash
bun run check
```

## Run With Docker

```bash
docker compose up --build
```

The container serves the SvelteKit app on port `3000` and the realtime
WebSocket server on port `24678`.

Caddy should proxy HTTP requests to the app and WebSocket upgrades to the
realtime server on the same public origin, for example:

```caddy
coup.example.com {
	@websocket {
		header Connection *Upgrade*
		header Upgrade websocket
	}

	handle @websocket {
		reverse_proxy coup:24678 {
			transport http {
				read_timeout 0
				write_timeout 0
			}
		}
	}

	handle {
		reverse_proxy coup:3000
	}
}
```
