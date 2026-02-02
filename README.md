# They Voted For This

Browser-based multiplayer political simulation where reality exists but perception is distorted by AI-controlled interpretation layers.

**If a system becomes solvable, it is broken.**

## Architecture

```
Players → Core Engine → [State Analyst → Judiciary → Media → Political Reaction → Crisis] → Historian
              ↑                              ↓ (modifiers)                                       |
              └──────────────────────────────┘                                            (read-only)
```

- **Backend**: Cloudflare Workers + Durable Objects (one DO instance = one game server)
- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages
- **AI**: Claude API (Sonnet) — 6 AI systems called sequentially each tick
- **State**: Persisted in Durable Object storage

See `shared/dataflow.html` for interactive architecture diagram.

## Project Structure

```
they-voted-for-this/
├── index.html                   # Frontend — game UI (GitHub Pages root)
├── app.js                       # Frontend — logic, API client, polling
├── styles.css                   # Frontend — dark theme
├── cloudflare-workers/          # Backend
│   ├── src/
│   │   ├── index.ts             # HTTP router, CORS, entry point
│   │   ├── game-server.ts       # Durable Object — game state, tick processing
│   │   ├── ai-integration.ts    # Claude API caller for each AI system
│   │   └── types.ts             # Environment types
│   ├── wrangler.toml            # Cloudflare config
│   ├── package.json
│   └── tsconfig.json
├── shared/                      # Shared between backend and frontend
│   ├── core-engine.ts           # Deterministic tick processor
│   ├── ai-contracts.ts          # System prompts + I/O schemas for all 6 AI
│   ├── types.ts                 # API request/response types
│   ├── world-state-schema.json  # JSON Schema v7 — full world state
│   └── world-state-initial.json # Tick 0 defaults
└── README.md
```

## Setup

### Prerequisites
- Node.js 18+
- Cloudflare account
- Claude API key (from console.anthropic.com)
- Wrangler CLI: `npm install -g wrangler`

### Backend Deploy

```bash
cd cloudflare-workers
npm install

# Authenticate with Cloudflare
wrangler login

# Set Claude API key as secret (not stored in code)
wrangler secret put CLAUDE_API_KEY
# Enter your key when prompted

# Deploy
wrangler deploy
```

Your API will be live at: `https://they-voted-for-this.<your-subdomain>.workers.dev`

### Frontend Deploy

1. Update `API_URL` in `app.js` to your worker URL
2. Push to GitHub
3. Go to repo Settings → Pages → Source: Deploy from branch
4. Branch: `main`, Folder: `/ (root)`
5. Save — site deploys to `https://<user>.github.io/they-voted-for-this/`

### Local Development

```bash
cd cloudflare-workers

# Start local dev server (uses real Durable Objects locally)
npm run dev

# Frontend: just open frontend/index.html in browser
# Update API_URL to http://localhost:8787
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `POST` | `/server/create` | Create new game server |
| `POST` | `/server/:id/join` | Join existing server |
| `GET` | `/server/:id/view?playerId=...&token=...` | Get player view |
| `POST` | `/server/:id/action` | Submit action |
| `GET` | `/server/:id/status` | Server status |

### Create Server
```json
POST /server/create
{
  "playerName": "Alice",
  "playerRole": "politician"
}
→ { "serverId": "...", "playerId": "...", "playerToken": "...", "tick": 0 }
```

### Submit Action
```json
POST /server/:id/action
{
  "playerId": "p-...",
  "playerToken": "...",
  "action": {
    "action_type": "propose_law",
    "params": { "text": "All businesses must pay minimum wage of 1.5x index" }
  }
}
→ { "success": true, "pendingCount": 1, "tick": 0 }
```

### Player View
```json
GET /server/:id/view?playerId=p-...&token=...
→ {
  "view": {
    "tick": 3,
    "role": "citizen",
    "wealth": 142.50,
    "headlines": [{ "text": "Economy shows signs of strain", "bias": "neutral" }],
    "rumors": [{ "text": "Sources say reserves are dwindling..." }],
    "market_signals": { "price_trend": "rising", "availability": "normal" },
    "government_signals": { "approval_vague": "mixed", "active_laws": 2 },
    "available_actions": ["work", "consume", "vote_law", "join_movement"],
    "role_specific": { "mood": "uneasy", "employed": true }
  }
}
```

## Player Roles

| Role | Actions | What They See |
|------|---------|---------------|
| **Citizen** | work, consume, vote, join/leave movement | mood, headlines, market signals |
| **Business Owner** | produce, set wages, lobby, evade/comply taxes | labor mood, employees, production |
| **Politician** | propose law (free-text!), vote, allocate budget, statement | noisy approval estimate, unemployment estimate |

Players **never** see raw numbers. Everything is filtered through `generatePlayerView()` with seeded noise.

## Tick Cycle

Every 12 hours (configurable):

1. **Players** submit actions
2. **Core Engine** processes actions deterministically
3. **State Analyst** evaluates objective reality
4. **Judiciary** interprets new laws adversarially
5. **Media** generates biased narratives
6. **Political Reaction** simulates public response
7. **Crisis** may inject destabilizing events
8. **Historian** records everything

## Design Documents

- `PROJECT_BRIEF.md` — Architecture and current status
- `DEVLOG.md` — Build history, decisions, open questions
- `CLAUDE_INSTRUCTIONS.md` — Instructions for AI assistant
- `shared/world-state-schema.json` — Complete JSON Schema
- `shared/ai-contracts.ts` — All 6 AI system prompts

## License

MIT
