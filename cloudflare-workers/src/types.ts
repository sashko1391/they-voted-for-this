// ============================================================================
// They Voted For This — Cloudflare Workers Environment Types
// ============================================================================

export interface Env {
  GAME_SERVER: DurableObjectNamespace;
  CLAUDE_API_KEY: string;
  TICK_INTERVAL_HOURS: string;
  MAX_PLAYERS_PER_SERVER: string;
}
