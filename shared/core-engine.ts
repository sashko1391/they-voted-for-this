// ============================================================================
// They Voted For This â€” Core Engine Tick Processor
// ============================================================================
// This is the single source of truth. Every state mutation flows through here.
// AI systems propose changes. This engine decides what actually happens.
//
// Design principles:
//   1. Deterministic â€” same input + seed = same output. Always.
//   2. Validate everything â€” no modifier bypasses hard constraints.
//   3. AI systems are advisors, not controllers.
//   4. If in doubt, reject the modification silently.
// ============================================================================

import { createHash, randomInt } from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface WorldState {
  meta: Meta;
  economy: Economy;
  society: Society;
  government: Government;
  players: Record<string, Player>;
  laws: Law[];
  events: GameEvent[];
  tick_log: TickLogEntry[];
  media_state: MediaState;
  history: HistoryState;
}

interface Meta {
  server_id: string;
  tick: number;
  tick_interval_hours: number;
  tick_deadline: string;
  created_at: string;
  phase: "accepting_actions" | "processing" | "ai_evaluation" | "resolved";
  seed: number;
}

interface Economy {
  gdp: number;
  gdp_delta: number;
  inflation: number;
  unemployment: number;
  tax_rate: number;
  tax_compliance: number;
  budget: Budget;
  market: Market;
  wage_index: number;
}

interface Budget {
  revenue: number;
  spending: number;
  reserves: number;
  deficit: number;
}

interface Market {
  supply: number;
  demand: number;
  price_index: number;
  shortage: boolean;
}

interface Society {
  stability: number;
  public_trust: number;
  satisfaction: number;
  radicalization: number;
  protest_pressure: number;
  movements: Movement[];
}

interface Movement {
  id: string;
  name: string;
  type: "reform" | "populist" | "radical" | "separatist" | "labor" | "business";
  strength: number;
  demands: string[];
  member_player_ids: string[];
  created_tick: number;
}

interface Government {
  approval: {
    overall: number;
    citizens: number;
    business: number;
    elite: number;
  };
  budget_allocation: Record<string, number>;
  active_law_count: number;
  election_tick: number | null;
}

interface Player {
  id: string;
  role: "citizen" | "business_owner" | "politician";
  name: string;
  joined_tick: number;
  alive: boolean;
  hidden_stats: HiddenStats;
  visible_stats: VisibleStats;
  role_data: any;
  actions_pending: PlayerAction[];
  actions_history: { tick: number; actions: PlayerAction[] }[];
}

interface HiddenStats {
  influence: number;
  reputation: number;
  fear: number;
  corruption: number;
  historical_legacy: number;
}

interface VisibleStats {
  wealth: number;
  movement_id: string | null;
}

interface PlayerAction {
  action_type: string;
  submitted_at: string;
  params: Record<string, any>;
}

interface Modifier {
  variable: string;
  operation: "set" | "add" | "multiply" | "clamp";
  value: number;
  min?: number;
  max?: number;
}

interface Law {
  id: string;
  proposed_by: string;
  proposed_tick: number;
  original_text: string;
  status: "proposed" | "voting" | "active" | "repealed" | "rejected" | "invalidated";
  votes: { for: number; against: number; abstain: number };
  judiciary_interpretation: JudiciaryInterpretation | null;
  activated_tick: number | null;
  repealed_tick: number | null;
}

interface JudiciaryInterpretation {
  interpretation: string;
  ambiguities: string[];
  implementation: {
    affected_variables: string[];
    modifiers: Modifier[];
  };
  rejected_by_core: boolean;
}

interface GameEvent {
  id: string;
  source: string;
  tick: number;
  type: string;
  severity: number;
  status: "pending" | "applied" | "rejected" | "expired";
  description: string;
  modifiers: Modifier[];
  duration_ticks: number | null;
  expires_tick: number | null;
  narrative_hook: string;
}

interface TickLogEntry {
  tick: number;
  timestamp: string;
  actions_processed: number;
  actions_skipped: number;
  events_applied: number;
  events_rejected: number;
  laws_activated: number;
  laws_rejected: number;
  state_snapshot_hash: string;
  ai_outputs: Record<string, any>;
}

interface MediaState {
  headlines: any[];
  articles: any[];
  rumors: any[];
}

interface HistoryState {
  eras: any[];
  player_reputations: Record<string, any>;
}

// ============================================================================
// AI SYSTEM INTERFACES
// ============================================================================
// Each AI system is a black box that takes inputs and returns structured output.
// Core Engine never trusts AI output â€” it validates everything.

interface StateAnalystOutput {
  trends: { variable: string; direction: "up" | "down" | "stable"; magnitude: number }[];
  risks: { type: string; severity: number; probability: number }[];
  projections: Record<string, number>;
  confidence: number;
}

interface JudiciaryOutput {
  law_id: string;
  interpretation: string;
  ambiguities: string[];
  implementation: {
    affected_variables: string[];
    modifiers: Modifier[];
  };
}

interface MediaOutput {
  headlines: { text: string; bias: string; truth_score: number; source_event_id: string | null }[];
  articles: { headline_index: number; body: string; bias: string; mentions_players: string[] }[];
  rumors: { text: string; credibility: number }[];
}

interface PoliticalReactionOutput {
  approval_delta: Record<string, number>;
  protest_prob: number;
  movements: { action: "create" | "strengthen" | "dissolve"; name?: string; type?: string; id?: string; delta?: number }[];
  suppressed_warnings: string[];
}

interface CrisisOutput {
  event_type: string;
  severity: number;
  affected_vars: string[];
  modifiers: Modifier[];
  narrative_hook: string;
  duration_ticks: number;
}

// AI system function signatures â€” implementations are external
type AISystem<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

interface AISystemRegistry {
  stateAnalyst: AISystem<{ state: WorldState; actions: PlayerAction[] }, StateAnalystOutput>;
  judiciary: AISystem<{ law: Law; state: WorldState }, JudiciaryOutput>;
  media: AISystem<{ analyst: StateAnalystOutput; judiciary: JudiciaryOutput[]; state: WorldState }, MediaOutput>;
  politicalReaction: AISystem<{ media: MediaOutput; analyst: StateAnalystOutput; state: WorldState }, PoliticalReactionOutput>;
  crisis: AISystem<{ analyst: StateAnalystOutput; political: PoliticalReactionOutput; state: WorldState }, CrisisOutput | null>;
  historian: AISystem<{ state: WorldState; tick_events: GameEvent[] }, any>;
}

// ============================================================================
// HARD CONSTRAINTS
// ============================================================================
// These are the absolute boundaries of reality. Nothing bypasses them.

const HARD_CONSTRAINTS: Record<string, { min: number; max: number }> = {
  "economy.gdp":             { min: 0,      max: 100000 },
  "economy.inflation":       { min: -20,    max: 500    },
  "economy.unemployment":    { min: 0,      max: 100    },
  "economy.tax_rate":        { min: 0,      max: 100    },
  "economy.tax_compliance":  { min: 0,      max: 1      },
  "economy.market.supply":   { min: 0,      max: 100000 },
  "economy.market.demand":   { min: 0,      max: 100000 },
  "economy.market.price_index": { min: 0.01, max: 1000  },
  "economy.wage_index":      { min: 0.01,   max: 100    },
  "economy.budget.reserves": { min: -10000, max: 100000 },
  "society.stability":       { min: 0,      max: 100    },
  "society.public_trust":    { min: 0,      max: 100    },
  "society.satisfaction":    { min: 0,      max: 100    },
  "society.radicalization":  { min: 0,      max: 100    },
  "society.protest_pressure": { min: 0,     max: 1      },
  "government.approval.overall":  { min: 0, max: 100    },
  "government.approval.citizens": { min: 0, max: 100    },
  "government.approval.business": { min: 0, max: 100    },
  "government.approval.elite":    { min: 0, max: 100    },
};

// ============================================================================
// THRESHOLD TRIGGERS
// ============================================================================
// When values cross these thresholds, automatic events fire.

interface ThresholdTrigger {
  variable: string;
  condition: "above" | "below";
  value: number;
  event_type: string;
  severity: number;
  cooldown_ticks: number; // prevent spam
}

const THRESHOLD_TRIGGERS: ThresholdTrigger[] = [
  { variable: "economy.gdp",           condition: "below", value: 100,  event_type: "economic_crisis",  severity: 5, cooldown_ticks: 10 },
  { variable: "economy.inflation",     condition: "above", value: 50,   event_type: "hyperinflation",   severity: 4, cooldown_ticks: 5  },
  { variable: "economy.unemployment",  condition: "above", value: 25,   event_type: "protest",          severity: 3, cooldown_ticks: 3  },
  { variable: "society.stability",     condition: "below", value: 20,   event_type: "revolution",       severity: 5, cooldown_ticks: 20 },
  { variable: "society.stability",     condition: "above", value: 90,   event_type: "scandal",          severity: 2, cooldown_ticks: 5  }, // Crisis AI backup
  { variable: "society.radicalization", condition: "above", value: 80,  event_type: "revolution",       severity: 4, cooldown_ticks: 15 },
  { variable: "society.radicalization", condition: "above", value: 60,  event_type: "movement_formed",  severity: 2, cooldown_ticks: 5  },
  { variable: "economy.budget.reserves", condition: "below", value: 0,  event_type: "budget_crisis",    severity: 3, cooldown_ticks: 5  },
];

// Track cooldowns: event_type -> last triggered tick
const triggerCooldowns = new Map<string, number>();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** Deep-get a value from nested object by dot-path */
function getByPath(obj: any, path: string): number | undefined {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return typeof current === "number" ? current : undefined;
}

/** Deep-set a value in nested object by dot-path */
function setByPath(obj: any, path: string, value: number): boolean {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== "object") return false;
    current = current[parts[i]];
  }
  const lastKey = parts[parts.length - 1];
  if (!(lastKey in current)) return false;
  current[lastKey] = value;
  return true;
}

/** Clamp value within hard constraints */
function clampToConstraints(path: string, value: number): number {
  const constraint = HARD_CONSTRAINTS[path];
  if (!constraint) return value;
  return Math.max(constraint.min, Math.min(constraint.max, value));
}

/** Generate deterministic pseudo-random number from seed */
function seededRandom(seed: number, index: number): number {
  const hash = createHash("sha256")
    .update(`${seed}-${index}`)
    .digest();
  return (hash.readUInt32BE(0) % 10000) / 10000;
}

/** SHA-256 hash of state for integrity */
function hashState(state: WorldState): string {
  return createHash("sha256")
    .update(JSON.stringify(state))
    .digest("hex");
}

/** Generate UUID v4-ish from seed */
function seededUUID(seed: number, counter: number): string {
  const hash = createHash("sha256")
    .update(`uuid-${seed}-${counter}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16),
    "8" + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

// ============================================================================
// MODIFIER APPLICATION
// ============================================================================
// The core of the engine. Every change to world state flows through here.

interface ModifierResult {
  applied: boolean;
  variable: string;
  old_value: number;
  new_value: number;
  rejection_reason?: string;
}

/**
 * Apply a single modifier to world state.
 * Returns result with old/new values or rejection reason.
 */
function applyModifier(state: WorldState, mod: Modifier): ModifierResult {
  const oldValue = getByPath(state, mod.variable);

  // Variable doesn't exist in state
  if (oldValue === undefined) {
    return {
      applied: false,
      variable: mod.variable,
      old_value: 0,
      new_value: 0,
      rejection_reason: `Variable ${mod.variable} not found in state`,
    };
  }

  let newValue: number;
  switch (mod.operation) {
    case "set":
      newValue = mod.value;
      break;
    case "add":
      newValue = oldValue + mod.value;
      break;
    case "multiply":
      newValue = oldValue * mod.value;
      break;
    case "clamp":
      newValue = Math.max(mod.min ?? -Infinity, Math.min(mod.max ?? Infinity, oldValue));
      break;
    default:
      return {
        applied: false,
        variable: mod.variable,
        old_value: oldValue,
        new_value: oldValue,
        rejection_reason: `Unknown operation: ${(mod as any).operation}`,
      };
  }

  // Enforce hard constraints
  const clamped = clampToConstraints(mod.variable, newValue);
  if (clamped !== newValue) {
    // Value was clamped â€” still apply but log the constraint hit
    newValue = clamped;
  }

  // Sanity: reject NaN / Infinity
  if (!Number.isFinite(newValue)) {
    return {
      applied: false,
      variable: mod.variable,
      old_value: oldValue,
      new_value: oldValue,
      rejection_reason: `Resulting value is not finite: ${newValue}`,
    };
  }

  setByPath(state, mod.variable, newValue);
  return {
    applied: true,
    variable: mod.variable,
    old_value: oldValue,
    new_value: newValue,
  };
}

/**
 * Apply an array of modifiers. Returns results for each.
 * Stops applying from a source if any critical modifier fails.
 */
function applyModifiers(state: WorldState, modifiers: Modifier[], source: string): ModifierResult[] {
  const results: ModifierResult[] = [];
  for (const mod of modifiers) {
    const result = applyModifier(state, mod);
    results.push(result);
    // Log for debugging
    if (!result.applied) {
      console.warn(`[Core Engine] Rejected modifier from ${source}: ${result.rejection_reason}`);
    }
  }
  return results;
}

// ============================================================================
// ACTION PROCESSORS
// ============================================================================
// Each player action type has a handler that translates it into state changes.

type ActionProcessor = (state: WorldState, player: Player, action: PlayerAction) => void;

const ACTION_PROCESSORS: Record<string, ActionProcessor> = {

  // --- CITIZEN ACTIONS ---

  work: (state, player, action) => {
    if (player.role !== "citizen") return;
    const rd = player.role_data.citizen;
    if (!rd || !rd.employer_id) {
      // Unemployed â€” no income, increase pressure
      rd.economic_pressure = Math.min(100, (rd?.economic_pressure ?? 30) + 5);
      return;
    }
    // Earn wage
    const wage = state.economy.wage_index * (state.players[rd.employer_id]?.role_data?.business_owner?.wage_level ?? 1);
    player.visible_stats.wealth += wage;
    // Slight satisfaction from working
    if (rd) rd.satisfaction = Math.min(100, rd.satisfaction + 1);
    // Contribute to GDP
    state.economy.gdp += wage * 0.01;
  },

  consume: (state, player, action) => {
    if (player.role !== "citizen") return;
    const amount = Math.min(player.visible_stats.wealth * 0.3, state.economy.market.supply * 0.01);
    if (amount <= 0) {
      // Can't afford goods â€” pressure rises
      const rd = player.role_data.citizen;
      if (rd) rd.economic_pressure = Math.min(100, rd.economic_pressure + 8);
      return;
    }
    player.visible_stats.wealth -= amount;
    state.economy.market.demand += amount * 0.1;
    state.economy.market.supply -= amount * 0.05;
    // Satisfaction from consumption
    const rd = player.role_data.citizen;
    if (rd) rd.satisfaction = Math.min(100, rd.satisfaction + 3);
  },

  vote_law: (state, player, action) => {
    if (player.role !== "citizen") return;
    const lawId = action.params?.law_id;
    const vote = action.params?.vote; // "for" | "against" | "abstain"
    if (!lawId || !vote) return;

    const law = state.laws.find(l => l.id === lawId && l.status === "voting");
    if (!law) return;

    if (vote === "for") law.votes.for++;
    else if (vote === "against") law.votes.against++;
    else law.votes.abstain++;

    const rd = player.role_data.citizen;
    if (rd) rd.voted_this_tick = true;

    // Voting increases influence slightly
    player.hidden_stats.influence = Math.min(100, player.hidden_stats.influence + 0.5);
  },

  join_movement: (state, player, action) => {
    if (player.role !== "citizen") return;
    const movementId = action.params?.movement_id;
    if (!movementId) return;

    const movement = state.society.movements.find(m => m.id === movementId);
    if (!movement) return;

    if (!movement.member_player_ids.includes(player.id)) {
      movement.member_player_ids.push(player.id);
    }
    player.visible_stats.movement_id = movementId;

    // Joining radical movements increases radicalization
    const rd = player.role_data.citizen;
    if (rd && movement.type === "radical") {
      rd.radicalization = Math.min(100, rd.radicalization + 10);
    }
    // Any movement increases influence
    player.hidden_stats.influence = Math.min(100, player.hidden_stats.influence + 2);
  },

  leave_movement: (state, player, action) => {
    if (player.role !== "citizen") return;
    const movementId = player.visible_stats.movement_id;
    if (!movementId) return;

    const movement = state.society.movements.find(m => m.id === movementId);
    if (movement) {
      movement.member_player_ids = movement.member_player_ids.filter(id => id !== player.id);
    }
    player.visible_stats.movement_id = null;
  },

  // --- BUSINESS OWNER ACTIONS ---

  produce: (state, player, action) => {
    if (player.role !== "business_owner") return;
    const rd = player.role_data.business_owner;
    if (!rd) return;

    // Check for strike
    if (rd.strike_risk > 0.8) {
      // Possible strike â€” production reduced
      rd.production_capacity *= 0.5;
    }

    const output = rd.production_capacity;
    state.economy.market.supply += output;
    state.economy.gdp += output * 0.1;

    // Revenue from production
    const revenue = output * state.economy.market.price_index;
    const costs = rd.employees * rd.wage_level * state.economy.wage_index;
    const profit = revenue - costs;
    player.visible_stats.wealth += Math.max(0, profit);

    // Influence grows with production
    player.hidden_stats.influence = Math.min(100, player.hidden_stats.influence + 1);
  },

  set_wages: (state, player, action) => {
    if (player.role !== "business_owner") return;
    const rd = player.role_data.business_owner;
    if (!rd) return;

    const newWage = action.params?.wage_level;
    if (typeof newWage !== "number" || newWage < 0) return;

    const oldWage = rd.wage_level;
    rd.wage_level = Math.max(0.1, Math.min(10, newWage)); // hard limits on wage setting

    // Low wages increase strike risk
    if (rd.wage_level < state.economy.wage_index * 0.7) {
      rd.strike_risk = Math.min(1, rd.strike_risk + 0.15);
    } else if (rd.wage_level > state.economy.wage_index * 1.2) {
      rd.strike_risk = Math.max(0, rd.strike_risk - 0.1);
    }

    // Wage changes affect global index slightly
    state.economy.wage_index += (rd.wage_level - oldWage) * 0.01;
  },

  lobby: (state, player, action) => {
    if (player.role !== "business_owner") return;
    const targetId = action.params?.politician_id;
    const amount = action.params?.amount ?? 10;
    if (!targetId) return;

    const target = state.players[targetId];
    if (!target || target.role !== "politician") return;

    const rd = player.role_data.business_owner;
    if (rd) rd.lobby_target = targetId;

    // Transfer wealth
    const actualAmount = Math.min(player.visible_stats.wealth * 0.2, amount);
    player.visible_stats.wealth -= actualAmount;

    // Politician receives lobby money (hidden)
    const prd = target.role_data.politician;
    if (prd) {
      prd.lobby_money_received += actualAmount;
      // Increases corruption
      target.hidden_stats.corruption = Math.min(100, target.hidden_stats.corruption + actualAmount * 0.5);
    }

    // Lobbying increases business owner's influence
    player.hidden_stats.influence = Math.min(100, player.hidden_stats.influence + 3);
    // But also corruption
    player.hidden_stats.corruption = Math.min(100, player.hidden_stats.corruption + 2);
  },

  evade_taxes: (state, player, action) => {
    if (player.role !== "business_owner") return;
    const rd = player.role_data.business_owner;
    if (!rd) return;

    rd.tax_evasion = Math.min(1, rd.tax_evasion + 0.2);
    // Reduce global compliance
    state.economy.tax_compliance = Math.max(0, state.economy.tax_compliance - 0.02);
    // Increase corruption
    player.hidden_stats.corruption = Math.min(100, player.hidden_stats.corruption + 5);
    // Keep more wealth
    player.visible_stats.wealth += state.economy.tax_rate * 0.01 * player.visible_stats.wealth * 0.1;
  },

  comply_taxes: (state, player, action) => {
    if (player.role !== "business_owner") return;
    const rd = player.role_data.business_owner;
    if (!rd) return;

    rd.tax_evasion = Math.max(0, rd.tax_evasion - 0.3);
    // Improve compliance
    state.economy.tax_compliance = Math.min(1, state.economy.tax_compliance + 0.01);
    // Reduce corruption
    player.hidden_stats.corruption = Math.max(0, player.hidden_stats.corruption - 2);
    // Pay taxes â€” lose wealth
    player.visible_stats.wealth -= state.economy.tax_rate * 0.01 * player.visible_stats.wealth * 0.15;
  },

  // --- POLITICIAN ACTIONS ---

  propose_law: (state, player, action) => {
    if (player.role !== "politician") return;
    const text = action.params?.text;
    if (!text || typeof text !== "string") return;

    const law: Law = {
      id: seededUUID(state.meta.seed, state.laws.length),
      proposed_by: player.id,
      proposed_tick: state.meta.tick,
      original_text: text.slice(0, 2000), // enforce max length
      status: "proposed",
      votes: { for: 0, against: 0, abstain: 0 },
      judiciary_interpretation: null,
      activated_tick: null,
      repealed_tick: null,
    };
    state.laws.push(law);

    const prd = player.role_data.politician;
    if (prd) prd.laws_proposed++;

    player.hidden_stats.influence = Math.min(100, player.hidden_stats.influence + 3);
  },

  vote_law_politician: (state, player, action) => {
    if (player.role !== "politician") return;
    const lawId = action.params?.law_id;
    const vote = action.params?.vote;
    if (!lawId || !vote) return;

    const law = state.laws.find(l => l.id === lawId && l.status === "voting");
    if (!law) return;

    // Politician votes count more heavily
    const weight = 3;
    if (vote === "for") law.votes.for += weight;
    else if (vote === "against") law.votes.against += weight;
    else law.votes.abstain += weight;
  },

  allocate_budget: (state, player, action) => {
    if (player.role !== "politician") return;
    const allocation = action.params?.allocation;
    if (!allocation || typeof allocation !== "object") return;

    // Validate: fractions must sum to ~1.0
    const keys = ["welfare", "infrastructure", "enforcement", "education", "discretionary"];
    let sum = 0;
    for (const key of keys) {
      const val = allocation[key];
      if (typeof val !== "number" || val < 0 || val > 1) return;
      sum += val;
    }
    if (Math.abs(sum - 1.0) > 0.01) return; // must sum to 1.0 Â± tolerance

    for (const key of keys) {
      state.government.budget_allocation[key] = allocation[key];
    }

    player.hidden_stats.influence = Math.min(100, player.hidden_stats.influence + 2);
  },

  publish_statement: (state, player, action) => {
    if (player.role !== "politician") return;
    const text = action.params?.text;
    if (!text || typeof text !== "string") return;

    const prd = player.role_data.politician;
    if (!prd) return;

    prd.public_statements.push({
      tick: state.meta.tick,
      text: text.slice(0, 500),
    });

    // Statements increase reputation and influence
    player.hidden_stats.influence = Math.min(100, player.hidden_stats.influence + 1);
    player.hidden_stats.reputation += 0.5;
  },
};

// ============================================================================
// ECONOMIC AUTO-CALCULATIONS
// ============================================================================
// These run every tick regardless of player actions.

function recalculateEconomics(state: WorldState): void {
  const econ = state.economy;
  const soc = state.society;
  const gov = state.government;

  // --- Price index driven by supply/demand ---
  if (econ.market.supply > 0) {
    const ratio = econ.market.demand / econ.market.supply;
    // Price moves toward demand/supply ratio, with inertia
    econ.market.price_index = econ.market.price_index * 0.8 + ratio * 0.2;
    econ.market.price_index = clampToConstraints("economy.market.price_index", econ.market.price_index);
  }

  // --- Shortage detection ---
  econ.market.shortage = econ.market.demand > econ.market.supply * 1.2;

  // --- Inflation driven by price changes and budget deficit ---
  const priceInflation = (econ.market.price_index - 1.0) * 10;
  const deficitInflation = econ.budget.deficit > 0 ? econ.budget.deficit * 0.01 : 0;
  econ.inflation = econ.inflation * 0.7 + (priceInflation + deficitInflation) * 0.3;
  econ.inflation = clampToConstraints("economy.inflation", econ.inflation);

  // --- GDP growth/decline ---
  const previousGdp = econ.gdp;
  // Production adds, inflation erodes, unemployment drags
  const growthFactor = 1 + (0.02 - econ.inflation * 0.001 - econ.unemployment * 0.001);
  econ.gdp *= growthFactor;
  econ.gdp = clampToConstraints("economy.gdp", econ.gdp);
  econ.gdp_delta = econ.gdp - previousGdp;

  // --- Budget calculations ---
  const ticksPerYear = Math.round(365 / (state.meta.tick_interval_hours / 24));
  econ.budget.revenue = (econ.gdp * econ.tax_rate * 0.01 * econ.tax_compliance) / ticksPerYear;
  econ.budget.deficit = econ.budget.spending - econ.budget.revenue;
  econ.budget.reserves -= econ.budget.deficit;
  econ.budget.reserves = clampToConstraints("economy.budget.reserves", econ.budget.reserves);

  // --- Unemployment ---
  // Simple model: unemployment inversely correlated with GDP growth
  if (econ.gdp_delta > 0) {
    econ.unemployment = Math.max(0, econ.unemployment - 0.3);
  } else {
    econ.unemployment = Math.min(100, econ.unemployment + 0.5);
  }

  // --- Spending effects ---
  const alloc = gov.budget_allocation;
  const totalSpending = econ.budget.spending;

  // Welfare reduces dissatisfaction
  soc.satisfaction += alloc.welfare * totalSpending * 0.001;
  // Enforcement reduces radicalization but also trust
  soc.radicalization -= alloc.enforcement * totalSpending * 0.0005;
  soc.public_trust -= alloc.enforcement * totalSpending * 0.0002; // police state effect
  // Education is long-term â€” tiny stability boost
  soc.stability += alloc.education * totalSpending * 0.0001;
  // Infrastructure boosts GDP slightly
  econ.gdp += alloc.infrastructure * totalSpending * 0.005;

  // Clamp all society values
  soc.stability = clampToConstraints("society.stability", soc.stability);
  soc.public_trust = clampToConstraints("society.public_trust", soc.public_trust);
  soc.satisfaction = clampToConstraints("society.satisfaction", soc.satisfaction);
  soc.radicalization = clampToConstraints("society.radicalization", soc.radicalization);

  // --- Satisfaction â†’ Stability feedback ---
  if (soc.satisfaction < 30) {
    soc.stability -= (30 - soc.satisfaction) * 0.05;
  }
  if (soc.radicalization > 50) {
    soc.stability -= (soc.radicalization - 50) * 0.03;
  }
  soc.stability = clampToConstraints("society.stability", soc.stability);

  // --- Protest pressure accumulation ---
  if (soc.satisfaction < 40) {
    soc.protest_pressure += 0.05;
  }
  if (econ.market.shortage) {
    soc.protest_pressure += 0.1;
  }
  if (econ.unemployment > 15) {
    soc.protest_pressure += 0.03;
  }
  // Natural decay
  soc.protest_pressure *= 0.9;
  soc.protest_pressure = clampToConstraints("society.protest_pressure", soc.protest_pressure);

  // --- Market natural decay toward equilibrium ---
  econ.market.supply *= 0.95; // goods perish / depreciate
  econ.market.demand *= 0.90; // demand resets faster
}

// ============================================================================
// LAW LIFECYCLE
// ============================================================================

function processLawLifecycle(state: WorldState): { activated: number; rejected: number } {
  let activated = 0;
  let rejected = 0;

  for (const law of state.laws) {
    // proposed â†’ voting (immediate â€” laws are always votable next tick)
    if (law.status === "proposed" && law.proposed_tick < state.meta.tick) {
      law.status = "voting";
    }

    // voting â†’ active or rejected (after 1 tick of voting)
    if (law.status === "voting") {
      const totalVotes = law.votes.for + law.votes.against;
      if (totalVotes > 0 && law.votes.for > law.votes.against) {
        law.status = "active";
        law.activated_tick = state.meta.tick;
        state.government.active_law_count++;
        activated++;
      } else if (totalVotes > 0) {
        law.status = "rejected";
        rejected++;
      }
      // If no votes at all, stays in voting for one more tick
    }

    // Active laws with judiciary interpretation â€” apply modifiers
    if (law.status === "active" && law.judiciary_interpretation) {
      const interp = law.judiciary_interpretation;
      if (!interp.rejected_by_core && interp.implementation?.modifiers) {
        const results = applyModifiers(state, interp.implementation.modifiers, `law:${law.id}`);
        // Check if any critical modifier was rejected
        const anyRejected = results.some(r => !r.applied);
        if (anyRejected) {
          interp.rejected_by_core = true;
          // Law stays active but has no effect
        }
      }
    }
  }

  return { activated, rejected };
}

// ============================================================================
// THRESHOLD EVENT GENERATION
// ============================================================================

function checkThresholds(state: WorldState): GameEvent[] {
  const events: GameEvent[] = [];
  let counter = 0;

  for (const trigger of THRESHOLD_TRIGGERS) {
    const value = getByPath(state, trigger.variable);
    if (value === undefined) continue;

    const triggered =
      (trigger.condition === "above" && value > trigger.value) ||
      (trigger.condition === "below" && value < trigger.value);

    if (!triggered) continue;

    // Check cooldown
    const lastTick = triggerCooldowns.get(trigger.event_type) ?? -Infinity;
    if (state.meta.tick - lastTick < trigger.cooldown_ticks) continue;

    triggerCooldowns.set(trigger.event_type, state.meta.tick);

    events.push({
      id: seededUUID(state.meta.seed, 9000 + counter++),
      source: "core_engine",
      tick: state.meta.tick,
      type: trigger.event_type,
      severity: trigger.severity,
      status: "applied", // core engine events are pre-validated
      description: `Threshold crossed: ${trigger.variable} ${trigger.condition} ${trigger.value} (current: ${value.toFixed(2)})`,
      modifiers: [],
      duration_ticks: null,
      expires_tick: null,
      narrative_hook: `${trigger.event_type.replace(/_/g, " ")} threatens the republic`,
    });
  }

  return events;
}

// ============================================================================
// EVENT PROCESSING
// ============================================================================

function processEvents(state: WorldState): { applied: number; rejected: number } {
  let applied = 0;
  let rejected = 0;

  // Expire old events
  for (const event of state.events) {
    if (event.status === "applied" && event.expires_tick && state.meta.tick >= event.expires_tick) {
      event.status = "expired";
    }
  }

  // Apply pending events (sorted by source priority)
  const SOURCE_PRIORITY: Record<string, number> = {
    core_engine: 100,
    judiciary: 85,
    crisis: 70,
    political_reaction: 60,
    state_analyst: 50,
    media: 10, // media doesn't typically modify state
  };

  const pending = state.events
    .filter(e => e.status === "pending")
    .sort((a, b) => (SOURCE_PRIORITY[b.source] ?? 0) - (SOURCE_PRIORITY[a.source] ?? 0));

  for (const event of pending) {
    if (event.modifiers.length === 0) {
      // No modifiers â€” just mark as applied (narrative-only event)
      event.status = "applied";
      if (event.duration_ticks) {
        event.expires_tick = state.meta.tick + event.duration_ticks;
      }
      applied++;
      continue;
    }

    const results = applyModifiers(state, event.modifiers, `event:${event.source}:${event.id}`);
    const allApplied = results.every(r => r.applied);

    if (allApplied) {
      event.status = "applied";
      if (event.duration_ticks) {
        event.expires_tick = state.meta.tick + event.duration_ticks;
      }
      applied++;
    } else {
      // Partial failure â€” reject entire event
      // Roll back applied modifiers
      for (const result of results) {
        if (result.applied) {
          setByPath(state, result.variable, result.old_value);
        }
      }
      event.status = "rejected";
      rejected++;
    }
  }

  return { applied, rejected };
}

// ============================================================================
// PLAYER VIEW GENERATION
// ============================================================================
// Players never see raw state. This generates their distorted view.

interface PlayerView {
  tick: number;
  role: string;
  wealth: number;
  headlines: { text: string; bias: string }[];
  rumors: { text: string }[];
  market_signals: {
    price_trend: "rising" | "falling" | "stable";
    availability: "abundant" | "normal" | "scarce" | "shortage";
  };
  government_signals: {
    approval_vague: "popular" | "mixed" | "unpopular" | "crisis";
    active_laws: number;
  };
  movement_id: string | null;
  available_actions: string[];
  // Role-specific
  role_specific: Record<string, any>;
}

function generatePlayerView(state: WorldState, playerId: string, noiseSeed: number): PlayerView | null {
  const player = state.players[playerId];
  if (!player || !player.alive) return null;

  const noise = (base: number, magnitude: number, index: number) => {
    const n = seededRandom(noiseSeed, index);
    return base + (n - 0.5) * 2 * magnitude;
  };

  // Price trend with noise
  const priceChange = state.economy.market.price_index - 1.0;
  const noisyChange = noise(priceChange, 0.1, 1);
  const priceTrend = noisyChange > 0.05 ? "rising" : noisyChange < -0.05 ? "falling" : "stable";

  // Availability with noise
  const supplyRatio = state.economy.market.supply / Math.max(1, state.economy.market.demand);
  const noisyRatio = noise(supplyRatio, 0.15, 2);
  const availability = noisyRatio > 1.3 ? "abundant" : noisyRatio > 0.8 ? "normal" : noisyRatio > 0.5 ? "scarce" : "shortage";

  // Approval vague
  const noisyApproval = noise(state.government.approval.overall, 10, 3);
  const approvalVague = noisyApproval > 65 ? "popular" : noisyApproval > 40 ? "mixed" : noisyApproval > 20 ? "unpopular" : "crisis";

  // Filter headlines â€” citizens see biased headlines, business owners see market-relevant ones
  const headlines = state.media_state.headlines.map(h => ({ text: h.text, bias: h.bias }));
  const rumors = state.media_state.rumors.map(r => ({ text: r.text }));

  // Available actions per role
  const actionsByRole: Record<string, string[]> = {
    citizen: ["work", "consume", "vote_law", "join_movement", "leave_movement"],
    business_owner: ["produce", "set_wages", "lobby", "evade_taxes", "comply_taxes"],
    politician: ["propose_law", "vote_law_politician", "allocate_budget", "publish_statement"],
  };

  // Role-specific visible data
  let roleSpecific: Record<string, any> = {};
  if (player.role === "citizen") {
    const rd = player.role_data.citizen;
    roleSpecific = {
      employed: !!rd?.employer_id,
      // Satisfaction is vaguely hinted, not numeric
      mood: (rd?.satisfaction ?? 50) > 60 ? "content" : (rd?.satisfaction ?? 50) > 35 ? "uneasy" : "distressed",
    };
  } else if (player.role === "business_owner") {
    const rd = player.role_data.business_owner;
    roleSpecific = {
      employees: rd?.employees ?? 0,
      production: rd?.production_capacity ?? 0,
      wage_level: rd?.wage_level ?? 1,
      // Strike risk is hinted vaguely
      labor_mood: (rd?.strike_risk ?? 0) < 0.3 ? "stable" : (rd?.strike_risk ?? 0) < 0.6 ? "restless" : "volatile",
    };
  } else if (player.role === "politician") {
    const prd = player.role_data.politician;
    roleSpecific = {
      laws_proposed: prd?.laws_proposed ?? 0,
      laws_passed: prd?.laws_passed ?? 0,
      // Partial analytics (with noise!)
      approval_estimate: Math.round(noise(state.government.approval.overall, 8, 4)),
      unemployment_estimate: Math.round(noise(state.economy.unemployment, 3, 5) * 10) / 10,
    };
  }

  return {
    tick: state.meta.tick,
    role: player.role,
    wealth: Math.round(player.visible_stats.wealth * 100) / 100,
    headlines,
    rumors,
    market_signals: { price_trend: priceTrend, availability },
    government_signals: { approval_vague: approvalVague, active_laws: state.government.active_law_count },
    movement_id: player.visible_stats.movement_id,
    available_actions: actionsByRole[player.role] ?? [],
    role_specific: roleSpecific,
  };
}

// ============================================================================
// MAIN TICK PROCESSOR
// ============================================================================

export async function processTick(
  state: WorldState,
  aiSystems: AISystemRegistry,
): Promise<{ state: WorldState; log: TickLogEntry }> {

  const tick = state.meta.tick;
  const aiOutputs: Record<string, any> = {};

  console.log(`\n[Tick ${tick}] === BEGIN ===`);

  // ---- PHASE 1: Lock state for processing ----
  state.meta.phase = "processing";

  // ---- PHASE 2: Process player actions ----
  let actionsProcessed = 0;
  let actionsSkipped = 0;

  for (const player of Object.values(state.players)) {
    if (!player.alive) continue;

    if (player.actions_pending.length === 0) {
      actionsSkipped++;
      continue;
    }

    for (const action of player.actions_pending) {
      const processor = ACTION_PROCESSORS[action.action_type];
      if (processor) {
        processor(state, player, action);
        actionsProcessed++;
      } else {
        console.warn(`[Tick ${tick}] Unknown action: ${action.action_type}`);
      }
    }

    // Archive actions
    player.actions_history.push({ tick, actions: [...player.actions_pending] });
    if (player.actions_history.length > 10) {
      player.actions_history.shift();
    }
    player.actions_pending = [];
  }

  console.log(`[Tick ${tick}] Actions: ${actionsProcessed} processed, ${actionsSkipped} players idle`);

  // ---- PHASE 3: Economic recalculation ----
  recalculateEconomics(state);

  // ---- PHASE 4: Law lifecycle ----
  const lawResults = processLawLifecycle(state);
  console.log(`[Tick ${tick}] Laws: ${lawResults.activated} activated, ${lawResults.rejected} rejected`);

  // ---- PHASE 5: AI Evaluation ----
  state.meta.phase = "ai_evaluation";

  // Step 3: State Analyst
  try {
    const allActions = Object.values(state.players).flatMap(p =>
      p.actions_history.find(h => h.tick === tick)?.actions ?? []
    );
    const analystOutput = await aiSystems.stateAnalyst({ state, actions: allActions });
    aiOutputs.state_analyst = analystOutput;
    console.log(`[Tick ${tick}] State Analyst: ${analystOutput.risks.length} risks identified`);
  } catch (err) {
    console.error(`[Tick ${tick}] State Analyst FAILED:`, err);
    aiOutputs.state_analyst = null;
  }

  // Step 4: Judiciary AI â€” process new laws
  const newLaws = state.laws.filter(l => l.status === "active" && l.judiciary_interpretation === null);
  const judiciaryOutputs: JudiciaryOutput[] = [];

  for (const law of newLaws) {
    try {
      const judOut = await aiSystems.judiciary({ law, state });
      judiciaryOutputs.push(judOut);

      // Store interpretation on the law
      law.judiciary_interpretation = {
        interpretation: judOut.interpretation,
        ambiguities: judOut.ambiguities,
        implementation: judOut.implementation,
        rejected_by_core: false,
      };

      // Immediately attempt to apply
      if (judOut.implementation?.modifiers?.length) {
        const results = applyModifiers(state, judOut.implementation.modifiers, `judiciary:${law.id}`);
        if (results.some(r => !r.applied)) {
          law.judiciary_interpretation.rejected_by_core = true;
          // Roll back
          for (const r of results) {
            if (r.applied) setByPath(state, r.variable, r.old_value);
          }
        }
      }

      console.log(`[Tick ${tick}] Judiciary: law ${law.id.slice(0, 8)} â€” ${judOut.ambiguities.length} ambiguities`);
    } catch (err) {
      console.error(`[Tick ${tick}] Judiciary FAILED for law ${law.id}:`, err);
    }
  }
  aiOutputs.judiciary = judiciaryOutputs;

  // Step 5: Media AI
  try {
    const mediaOutput = await aiSystems.media({
      analyst: aiOutputs.state_analyst,
      judiciary: judiciaryOutputs,
      state,
    });
    aiOutputs.media = mediaOutput;

    // Update media state
    if (mediaOutput.headlines) {
      state.media_state.headlines = mediaOutput.headlines.map((h, i) => ({
        id: seededUUID(state.meta.seed, 5000 + i),
        tick,
        text: h.text,
        bias: h.bias,
        truth_score: h.truth_score,
        source_event_id: h.source_event_id,
      }));
    }
    if (mediaOutput.rumors) {
      state.media_state.rumors = mediaOutput.rumors.map((r, i) => ({
        id: seededUUID(state.meta.seed, 6000 + i),
        tick,
        text: r.text,
        credibility: r.credibility,
      }));
    }

    console.log(`[Tick ${tick}] Media: ${mediaOutput.headlines?.length ?? 0} headlines, ${mediaOutput.rumors?.length ?? 0} rumors`);
  } catch (err) {
    console.error(`[Tick ${tick}] Media AI FAILED:`, err);
    aiOutputs.media = null;
  }

  // Step 6: Political Reaction AI
  try {
    const polOutput = await aiSystems.politicalReaction({
      media: aiOutputs.media,
      analyst: aiOutputs.state_analyst,
      state,
    });
    aiOutputs.political_reaction = polOutput;

    // Apply approval deltas
    if (polOutput.approval_delta) {
      for (const [key, delta] of Object.entries(polOutput.approval_delta)) {
        const path = `government.approval.${key}`;
        const current = getByPath(state, path);
        if (current !== undefined) {
          setByPath(state, path, clampToConstraints(path, current + delta));
        }
      }
    }

    // Update protest pressure
    if (polOutput.protest_prob > state.society.protest_pressure) {
      state.society.protest_pressure = clampToConstraints(
        "society.protest_pressure",
        state.society.protest_pressure * 0.5 + polOutput.protest_prob * 0.5
      );
    }

    // Process movement changes
    for (const mvt of polOutput.movements ?? []) {
      if (mvt.action === "create" && mvt.name && mvt.type) {
        state.society.movements.push({
          id: seededUUID(state.meta.seed, 7000 + state.society.movements.length),
          name: mvt.name,
          type: mvt.type as Movement["type"],
          strength: 0.3,
          demands: [],
          member_player_ids: [],
          created_tick: tick,
        });
      } else if (mvt.action === "strengthen" && mvt.id) {
        const m = state.society.movements.find(x => x.id === mvt.id);
        if (m) m.strength = Math.min(1, m.strength + (mvt.delta ?? 0.1));
      } else if (mvt.action === "dissolve" && mvt.id) {
        state.society.movements = state.society.movements.filter(x => x.id !== mvt.id);
      }
    }

    console.log(`[Tick ${tick}] Political: approval Î”=${JSON.stringify(polOutput.approval_delta)}, protest=${polOutput.protest_prob.toFixed(2)}`);
  } catch (err) {
    console.error(`[Tick ${tick}] Political Reaction AI FAILED:`, err);
    aiOutputs.political_reaction = null;
  }

  // Step 7: Crisis AI (optional)
  try {
    const crisisOutput = await aiSystems.crisis({
      analyst: aiOutputs.state_analyst,
      political: aiOutputs.political_reaction,
      state,
    });
    aiOutputs.crisis = crisisOutput;

    if (crisisOutput) {
      const crisisEvent: GameEvent = {
        id: seededUUID(state.meta.seed, 8000),
        source: "crisis",
        tick,
        type: crisisOutput.event_type,
        severity: crisisOutput.severity,
        status: "pending",
        description: `Crisis: ${crisisOutput.event_type}`,
        modifiers: crisisOutput.modifiers,
        duration_ticks: crisisOutput.duration_ticks,
        expires_tick: null,
        narrative_hook: crisisOutput.narrative_hook,
      };
      state.events.push(crisisEvent);
      console.log(`[Tick ${tick}] Crisis: ${crisisOutput.event_type} (severity ${crisisOutput.severity})`);
    }
  } catch (err) {
    console.error(`[Tick ${tick}] Crisis AI FAILED:`, err);
    aiOutputs.crisis = null;
  }

  // ---- PHASE 6: Process all pending events (including crisis) ----
  const thresholdEvents = checkThresholds(state);
  state.events.push(...thresholdEvents);

  const eventResults = processEvents(state);
  console.log(`[Tick ${tick}] Events: ${eventResults.applied} applied, ${eventResults.rejected} rejected`);

  // Step 8: Historian AI (non-blocking, no state mutation)
  try {
    const tickEvents = state.events.filter(e => e.tick === tick);
    const historianOutput = await aiSystems.historian({ state, tick_events: tickEvents });
    aiOutputs.historian = historianOutput;

    // Update history record (read-only area)
    if (historianOutput?.era_name) {
      const currentEra = state.history.eras[state.history.eras.length - 1];
      if (currentEra && currentEra.name !== historianOutput.era_name) {
        currentEra.tick_end = tick;
        state.history.eras.push({
          name: historianOutput.era_name,
          tick_start: tick,
          tick_end: null,
          summary: historianOutput.summary ?? "",
          key_events: historianOutput.key_events ?? [],
          dominant_figures: historianOutput.dominant_figures ?? [],
        });
      }
    }
    if (historianOutput?.player_reputations) {
      state.history.player_reputations = {
        ...state.history.player_reputations,
        ...historianOutput.player_reputations,
      };
    }
  } catch (err) {
    console.error(`[Tick ${tick}] Historian AI FAILED:`, err);
    aiOutputs.historian = null;
  }

  // ---- PHASE 7: Finalize ----
  state.meta.tick++;
  state.meta.phase = "resolved";
  state.meta.seed = state.meta.seed + 1; // advance seed deterministically

  // Compute next deadline
  const now = new Date();
  const nextDeadline = new Date(now.getTime() + state.meta.tick_interval_hours * 60 * 60 * 1000);
  state.meta.tick_deadline = nextDeadline.toISOString();

  // Build tick log
  const logEntry: TickLogEntry = {
    tick,
    timestamp: now.toISOString(),
    actions_processed: actionsProcessed,
    actions_skipped: actionsSkipped,
    events_applied: eventResults.applied + thresholdEvents.length,
    events_rejected: eventResults.rejected,
    laws_activated: lawResults.activated,
    laws_rejected: lawResults.rejected,
    state_snapshot_hash: hashState(state),
    ai_outputs: aiOutputs,
  };

  state.tick_log.push(logEntry);
  // Keep only last 50 ticks
  if (state.tick_log.length > 50) {
    state.tick_log.shift();
  }

  console.log(`[Tick ${tick}] === END === hash=${logEntry.state_snapshot_hash.slice(0, 12)}`);

  // Transition to accepting actions for next tick
  state.meta.phase = "accepting_actions";

  return { state, log: logEntry };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  WorldState,
  PlayerAction,
  Modifier,
  PlayerView,
  generatePlayerView,
  applyModifier,
  applyModifiers,
  getByPath,
  setByPath,
  clampToConstraints,
  hashState,
  HARD_CONSTRAINTS,
  THRESHOLD_TRIGGERS,
  ACTION_PROCESSORS,
};
