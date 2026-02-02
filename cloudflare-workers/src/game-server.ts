// ============================================================================
// They Voted For This — Game Server Durable Object
// ============================================================================
// One instance per game server. Owns the world state.
// Handles: player join, action submit, view generation, tick processing.
// Uses Durable Object Alarms for automatic tick scheduling.
// ============================================================================

import { processTick, generatePlayerView } from "../../shared/core-engine";
import { buildAIRegistry } from "./ai-integration";
import { Env } from "./types";

// ============================================================================
// INITIAL STATE TEMPLATE
// ============================================================================
// Embedded to avoid file I/O in Workers. Matches world-state-initial.json.

function createInitialState(
  serverId: string,
  tickIntervalHours: number
): any {
  const now = new Date();
  const deadline = new Date(
    now.getTime() + tickIntervalHours * 60 * 60 * 1000
  );

  return {
    meta: {
      server_id: serverId,
      tick: 0,
      tick_interval_hours: tickIntervalHours,
      tick_deadline: deadline.toISOString(),
      created_at: now.toISOString(),
      phase: "accepting_actions",
      seed: 42,
    },
    economy: {
      gdp: 1000.0,
      gdp_delta: 0,
      inflation: 2.0,
      unemployment: 5.0,
      tax_rate: 20.0,
      tax_compliance: 0.8,
      budget: {
        revenue: 160.0,
        spending: 150.0,
        reserves: 500.0,
        deficit: -10.0,
      },
      market: {
        supply: 100.0,
        demand: 95.0,
        price_index: 1.0,
        shortage: false,
      },
      wage_index: 1.0,
    },
    society: {
      stability: 65.0,
      public_trust: 50.0,
      satisfaction: 50.0,
      radicalization: 10.0,
      protest_pressure: 0.1,
      movements: [],
    },
    government: {
      approval: {
        overall: 45.0,
        citizens: 45.0,
        business: 50.0,
        elite: 55.0,
      },
      budget_allocation: {
        welfare: 0.3,
        infrastructure: 0.25,
        enforcement: 0.2,
        education: 0.15,
        discretionary: 0.1,
      },
      active_law_count: 0,
      election_tick: null,
    },
    players: {},
    laws: [],
    events: [],
    tick_log: [],
    media_state: {
      headlines: [
        {
          id: "h-00000000-0001",
          tick: 0,
          text: "New government takes office amid cautious optimism",
          bias: "neutral",
          truth_score: 0.7,
          source_event_id: null,
        },
        {
          id: "h-00000000-0002",
          tick: 0,
          text: "Economy stable but experts warn of challenges ahead",
          bias: "establishment",
          truth_score: 0.8,
          source_event_id: null,
        },
        {
          id: "h-00000000-0003",
          tick: 0,
          text: "Business leaders quietly optimistic about deregulation prospects",
          bias: "right",
          truth_score: 0.4,
          source_event_id: null,
        },
      ],
      articles: [],
      rumors: [
        {
          id: "r-00000000-0001",
          tick: 0,
          text: "Sources suggest budget reserves may be lower than officially reported",
          credibility: 0.5,
        },
      ],
    },
    history: {
      eras: [
        {
          name: "The Founding",
          tick_start: 0,
          tick_end: null,
          summary: "A new republic begins.",
          key_events: [],
          dominant_figures: [],
        },
      ],
      player_reputations: {},
    },
  };
}

// ============================================================================
// TOKEN GENERATION
// ============================================================================

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function generatePlayerId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// ROLE-SPECIFIC DEFAULT DATA
// ============================================================================

function getDefaultRoleData(role: string): any {
  switch (role) {
    case "citizen":
      return {
        citizen: {
          employer_id: null,
          satisfaction: 50.0,
          economic_pressure: 30.0,
          radicalization: 5.0,
          voted_this_tick: false,
        },
      };
    case "business_owner":
      return {
        business_owner: {
          production_capacity: 10.0,
          wage_level: 1.0,
          employees: 5,
          tax_evasion: 0.0,
          lobby_target: null,
          strike_risk: 0.1,
          lobby_money_received: 0,
        },
      };
    case "politician":
      return {
        politician: {
          party: null,
          laws_proposed: 0,
          laws_passed: 0,
          public_statements: [],
          lobby_money_received: 0,
        },
      };
    default:
      return {};
  }
}

// ============================================================================
// GAME SERVER DURABLE OBJECT
// ============================================================================

export class GameServer implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  // Cached in memory — loaded from storage on first request
  private worldState: any | null = null;
  private playerTokens: Map<string, string> = new Map(); // playerId -> token
  private claudeApiKey: string = "";
  private maxPlayers: number = 50;
  private initialized: boolean = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ---- Load state from storage ----
  private async ensureLoaded(): Promise<void> {
    if (this.worldState) return;

    const stored = await this.state.storage.get("worldState");
    if (stored) {
      this.worldState = stored;
      this.initialized = true;
    }

    const tokens = await this.state.storage.get("playerTokens");
    if (tokens) {
      this.playerTokens = new Map(Object.entries(tokens as any));
    }

    const key = await this.state.storage.get("claudeApiKey");
    if (key) this.claudeApiKey = key as string;

    const maxP = await this.state.storage.get("maxPlayers");
    if (maxP) this.maxPlayers = maxP as number;
  }

  // ---- Save state to storage ----
  private async saveState(): Promise<void> {
    await this.state.storage.put("worldState", this.worldState);
    await this.state.storage.put(
      "playerTokens",
      Object.fromEntries(this.playerTokens)
    );
  }

  // ---- Alarm handler for automatic ticks ----
  async alarm(): Promise<void> {
    await this.ensureLoaded();
    if (!this.worldState) return;

    console.log(
      `[GameServer] Alarm fired — processing tick ${this.worldState.meta.tick}`
    );

    try {
      await this.runTick();
    } catch (err) {
      console.error("[GameServer] Tick processing failed:", err);
    }

    // Schedule next tick
    await this.scheduleNextTick();
  }

  // ---- Schedule next tick alarm ----
  private async scheduleNextTick(): Promise<void> {
    if (!this.worldState) return;

    const intervalMs =
      this.worldState.meta.tick_interval_hours * 60 * 60 * 1000;
    const nextTick = Date.now() + intervalMs;

    await this.state.storage.setAlarm(nextTick);
    console.log(
      `[GameServer] Next tick scheduled at ${new Date(nextTick).toISOString()}`
    );
  }

  // ---- Run full tick ----
  private async runTick(): Promise<void> {
    if (!this.worldState) return;

    const aiRegistry = buildAIRegistry(this.claudeApiKey);
    const result = await processTick(this.worldState, aiRegistry);
    this.worldState = result.state;

    await this.saveState();
    console.log(
      `[GameServer] Tick ${result.log.tick} complete — ${result.log.actions_processed} actions, ${result.log.events_applied} events`
    );
  }

  // ---- Validate player token ----
  private validateToken(
    playerId: string,
    token: string
  ): boolean {
    return this.playerTokens.get(playerId) === token;
  }

  // ---- HTTP request handler ----
  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case "/initialize":
          return this.handleInitialize(request);
        case "/join":
          return this.handleJoin(request);
        case "/view":
          return this.handleView(request);
        case "/action":
          return this.handleAction(request);
        case "/status":
          return this.handleStatus();
        default:
          return jsonRes({ error: "Unknown DO route" }, 404);
      }
    } catch (err) {
      console.error("[GameServer] Handler error:", err);
      return jsonRes(
        { error: `Internal: ${(err as Error).message}` },
        500
      );
    }
  }

  // ---- POST /initialize ----
  private async handleInitialize(request: Request): Promise<Response> {
    if (this.initialized) {
      return jsonRes({ error: "Server already initialized" }, 400);
    }

    const body = (await request.json()) as any;
    const { playerName, playerRole, tickIntervalHours, maxPlayers, claudeApiKey } =
      body;

    // Store config
    this.claudeApiKey = claudeApiKey;
    this.maxPlayers = maxPlayers;
    await this.state.storage.put("claudeApiKey", claudeApiKey);
    await this.state.storage.put("maxPlayers", maxPlayers);

    // Create initial world state
    const serverId = this.state.id.toString();
    this.worldState = createInitialState(serverId, tickIntervalHours);
    this.initialized = true;

    // Add the creating player
    const playerId = generatePlayerId();
    const token = generateToken();
    this.addPlayerToState(playerId, playerName, playerRole);
    this.playerTokens.set(playerId, token);

    await this.saveState();

    // Schedule first tick
    await this.scheduleNextTick();

    return jsonRes({
      playerId,
      playerToken: token,
      tick: this.worldState.meta.tick,
      tickDeadline: this.worldState.meta.tick_deadline,
    });
  }

  // ---- POST /join ----
  private async handleJoin(request: Request): Promise<Response> {
    if (!this.initialized || !this.worldState) {
      return jsonRes({ error: "Server not initialized" }, 400);
    }

    const body = (await request.json()) as any;
    const { playerName, playerRole } = body;

    if (!playerName || !playerRole) {
      return jsonRes({ error: "Missing playerName or playerRole" }, 400);
    }
    if (!["citizen", "business_owner", "politician"].includes(playerRole)) {
      return jsonRes({ error: "Invalid role" }, 400);
    }

    const playerCount = Object.keys(this.worldState.players).length;
    if (playerCount >= this.maxPlayers) {
      return jsonRes({ error: "Server full" }, 403);
    }

    if (this.worldState.meta.phase !== "accepting_actions") {
      return jsonRes(
        { error: "Server is processing a tick. Try again shortly." },
        409
      );
    }

    const playerId = generatePlayerId();
    const token = generateToken();
    this.addPlayerToState(playerId, playerName, playerRole);
    this.playerTokens.set(playerId, token);

    await this.saveState();

    return jsonRes({
      playerId,
      playerToken: token,
      tick: this.worldState.meta.tick,
      tickDeadline: this.worldState.meta.tick_deadline,
    });
  }

  // ---- GET /view ----
  private async handleView(request: Request): Promise<Response> {
    if (!this.worldState) {
      return jsonRes({ error: "Server not initialized" }, 400);
    }

    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId");
    const token = url.searchParams.get("token");

    if (!playerId || !token) {
      return jsonRes({ error: "Missing playerId or token" }, 400);
    }
    if (!this.validateToken(playerId, token)) {
      return jsonRes({ error: "Invalid token" }, 401);
    }

    const noiseSeed =
      this.worldState.meta.seed * 1000 + this.worldState.meta.tick;
    const view = generatePlayerView(
      this.worldState,
      playerId,
      noiseSeed
    );

    if (!view) {
      return jsonRes({ error: "Player not found or not alive" }, 404);
    }

    return jsonRes({
      view,
      tick: this.worldState.meta.tick,
      phase: this.worldState.meta.phase,
      tickDeadline: this.worldState.meta.tick_deadline,
    });
  }

  // ---- POST /action ----
  private async handleAction(request: Request): Promise<Response> {
    if (!this.worldState) {
      return jsonRes({ error: "Server not initialized" }, 400);
    }

    if (this.worldState.meta.phase !== "accepting_actions") {
      return jsonRes(
        { error: "Not accepting actions — tick is processing" },
        409
      );
    }

    const body = (await request.json()) as any;
    const { playerId, playerToken, action } = body;

    if (!playerId || !playerToken || !action) {
      return jsonRes(
        { error: "Missing playerId, playerToken, or action" },
        400
      );
    }
    if (!this.validateToken(playerId, playerToken)) {
      return jsonRes({ error: "Invalid token" }, 401);
    }

    const player = this.worldState.players[playerId];
    if (!player || !player.alive) {
      return jsonRes({ error: "Player not found or not alive" }, 404);
    }

    // Validate action_type exists
    const validActions: Record<string, string[]> = {
      citizen: ["work", "consume", "vote_law", "join_movement", "leave_movement"],
      business_owner: [
        "produce",
        "set_wages",
        "lobby",
        "evade_taxes",
        "comply_taxes",
      ],
      politician: [
        "propose_law",
        "vote_law_politician",
        "allocate_budget",
        "publish_statement",
      ],
    };

    const allowed = validActions[player.role] ?? [];
    if (!allowed.includes(action.action_type)) {
      return jsonRes(
        {
          error: `Action '${action.action_type}' not valid for role '${player.role}'`,
        },
        400
      );
    }

    // Rate limit: max 5 pending actions per player per tick
    if (player.actions_pending.length >= 5) {
      return jsonRes(
        { error: "Max 5 actions per tick" },
        429
      );
    }

    // Add to pending
    player.actions_pending.push({
      action_type: action.action_type,
      submitted_at: new Date().toISOString(),
      params: action.params ?? {},
    });

    await this.saveState();

    return jsonRes({
      success: true,
      pendingCount: player.actions_pending.length,
      tick: this.worldState.meta.tick,
    });
  }

  // ---- GET /status ----
  private handleStatus(): Response {
    if (!this.worldState) {
      return jsonRes({ initialized: false });
    }

    const playerCount = Object.keys(this.worldState.players).length;
    const playerSummary: Record<string, any> = {};

    for (const [id, player] of Object.entries(
      this.worldState.players
    ) as any[]) {
      playerSummary[id] = {
        name: player.name,
        role: player.role,
        alive: player.alive,
        actionsPending: player.actions_pending.length,
      };
    }

    return jsonRes({
      initialized: true,
      tick: this.worldState.meta.tick,
      phase: this.worldState.meta.phase,
      tickDeadline: this.worldState.meta.tick_deadline,
      playerCount,
      maxPlayers: this.maxPlayers,
      players: playerSummary,
      activeLaws: this.worldState.laws.filter(
        (l: any) => l.status === "active"
      ).length,
      activeEvents: this.worldState.events.filter(
        (e: any) => e.status === "applied"
      ).length,
    });
  }

  // ---- Helper: add player to world state ----
  private addPlayerToState(
    playerId: string,
    name: string,
    role: string
  ): void {
    if (!this.worldState) return;

    this.worldState.players[playerId] = {
      id: playerId,
      role,
      name,
      joined_tick: this.worldState.meta.tick,
      alive: true,
      hidden_stats: {
        influence: 5.0,
        reputation: 0.0,
        fear: 0.0,
        corruption: 0.0,
        historical_legacy: 0.0,
      },
      visible_stats: {
        wealth: 100.0,
        movement_id: null,
      },
      role_data: getDefaultRoleData(role),
      actions_pending: [],
      actions_history: [],
    };
  }
}

// ============================================================================
// UTILITY
// ============================================================================

function jsonRes(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
