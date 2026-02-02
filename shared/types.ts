// ============================================================================
// They Voted For This — Shared API Types
// ============================================================================
// Types shared between Cloudflare Workers backend and frontend.
// ============================================================================

// ---- API Requests ----

export interface CreateServerRequest {
  playerName: string;
  playerRole: "citizen" | "business_owner" | "politician";
}

export interface CreateServerResponse {
  serverId: string;
  playerId: string;
  playerToken: string;
  tick: number;
  tickDeadline: string;
}

export interface JoinServerRequest {
  playerName: string;
  playerRole: "citizen" | "business_owner" | "politician";
}

export interface JoinServerResponse {
  playerId: string;
  playerToken: string;
  tick: number;
  tickDeadline: string;
}

export interface SubmitActionRequest {
  playerId: string;
  playerToken: string;
  action: {
    action_type: string;
    params?: Record<string, any>;
  };
}

export interface SubmitActionResponse {
  success: boolean;
  pendingCount: number;
  tick: number;
}

export interface ServerStatus {
  initialized: boolean;
  tick: number;
  phase: "accepting_actions" | "processing" | "ai_evaluation" | "resolved";
  tickDeadline: string;
  playerCount: number;
  maxPlayers: number;
  players: Record<
    string,
    {
      name: string;
      role: string;
      alive: boolean;
      actionsPending: number;
    }
  >;
  activeLaws: number;
  activeEvents: number;
}

// ---- Player View (returned by GET /view) ----

export interface PlayerViewResponse {
  view: {
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
    role_specific: Record<string, any>;
  };
  tick: number;
  phase: string;
  tickDeadline: string;
}

// ---- Action Definitions per Role ----

export const ACTIONS_BY_ROLE: Record<string, ActionDef[]> = {
  citizen: [
    { type: "work", label: "Work", params: [] },
    { type: "consume", label: "Consume Goods", params: [] },
    {
      type: "vote_law",
      label: "Vote on Law",
      params: [
        { name: "law_id", type: "text", label: "Law ID" },
        { name: "vote", type: "select", label: "Vote", options: ["for", "against", "abstain"] },
      ],
    },
    {
      type: "join_movement",
      label: "Join Movement",
      params: [{ name: "movement_id", type: "text", label: "Movement ID" }],
    },
    { type: "leave_movement", label: "Leave Movement", params: [] },
  ],
  business_owner: [
    { type: "produce", label: "Produce Goods", params: [] },
    {
      type: "set_wages",
      label: "Set Wages",
      params: [
        { name: "wage_level", type: "number", label: "Wage Level (0.1-10)" },
      ],
    },
    {
      type: "lobby",
      label: "Lobby Politician",
      params: [
        { name: "politician_id", type: "text", label: "Politician ID" },
        { name: "amount", type: "number", label: "Amount" },
      ],
    },
    { type: "evade_taxes", label: "Evade Taxes", params: [] },
    { type: "comply_taxes", label: "Comply with Taxes", params: [] },
  ],
  politician: [
    {
      type: "propose_law",
      label: "Propose Law",
      params: [{ name: "text", type: "textarea", label: "Law Text" }],
    },
    {
      type: "vote_law_politician",
      label: "Vote on Law",
      params: [
        { name: "law_id", type: "text", label: "Law ID" },
        { name: "vote", type: "select", label: "Vote", options: ["for", "against", "abstain"] },
      ],
    },
    {
      type: "allocate_budget",
      label: "Allocate Budget",
      params: [
        { name: "welfare", type: "number", label: "Welfare (0-1)" },
        { name: "infrastructure", type: "number", label: "Infrastructure (0-1)" },
        { name: "enforcement", type: "number", label: "Enforcement (0-1)" },
        { name: "education", type: "number", label: "Education (0-1)" },
        { name: "discretionary", type: "number", label: "Discretionary (0-1)" },
      ],
    },
    {
      type: "publish_statement",
      label: "Publish Statement",
      params: [{ name: "text", type: "textarea", label: "Statement Text" }],
    },
  ],
};

export interface ActionDef {
  type: string;
  label: string;
  params: ActionParamDef[];
}

export interface ActionParamDef {
  name: string;
  type: "text" | "number" | "textarea" | "select";
  label: string;
  options?: string[];
}
