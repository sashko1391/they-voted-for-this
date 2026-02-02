// ============================================================================
// They Voted For This — AI Integration Layer
// ============================================================================
// Bridges Core Engine's AISystemRegistry to actual Claude API calls.
// Uses contracts from ai-contracts.ts, handles failures per contract spec.
// ============================================================================

import {
  AI_CONTRACTS,
  buildAICallPayload,
  parseAIResponse,
  REQUIRED_FIELDS,
} from "../../shared/ai-contracts";

// ============================================================================
// BASE API CALLER
// ============================================================================

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  model: string = "claude-sonnet-4-5-20250929"
): Promise<string> {
  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Claude API ${response.status}: ${errorBody}`);
  }

  const result = (await response.json()) as any;
  return (
    result.content
      ?.map((block: any) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

// ============================================================================
// PER-SYSTEM CALLERS
// ============================================================================
// Each function matches the AISystemRegistry signature from core-engine.ts.
// Each wraps the call in error handling and returns fallback on failure.

export async function callStateAnalyst(
  input: { state: any; actions: any[]; previous_analysis?: any },
  apiKey: string
): Promise<any | null> {
  const contract = AI_CONTRACTS.state_analyst;

  try {
    const inputData = {
      state: input.state,
      actions: input.actions,
      previous_analysis: input.previous_analysis ?? null,
    };

    const userMessage = `TICK INPUT DATA:\n${JSON.stringify(inputData, null, 2)}\n\nAnalyze and respond with valid JSON only.`;
    const raw = await callClaude(
      contract.system_prompt,
      userMessage,
      contract.temperature,
      contract.max_tokens,
      apiKey
    );

    const result = parseAIResponse<any>(raw, REQUIRED_FIELDS.state_analyst);
    if (!result.success) {
      console.error(`[State Analyst] Parse failed: ${result.error}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error(`[State Analyst] Call failed:`, err);
    return null; // fallback: continue without analyst
  }
}

export async function callJudiciary(
  input: { law: any; active_laws: any[]; state_summary: any },
  apiKey: string
): Promise<any | null> {
  const contract = AI_CONTRACTS.judiciary;

  try {
    const inputData = {
      law: {
        id: input.law.id,
        original_text: input.law.original_text,
        proposed_by: input.law.proposed_by,
        proposed_tick: input.law.proposed_tick,
      },
      active_laws: input.active_laws.map((l: any) => ({
        id: l.id,
        original_text: l.original_text,
        interpretation: l.judiciary_interpretation?.interpretation ?? "",
      })),
      state_summary: input.state_summary,
    };

    const userMessage = `TICK INPUT DATA:\n${JSON.stringify(inputData, null, 2)}\n\nAnalyze and respond with valid JSON only.`;
    const raw = await callClaude(
      contract.system_prompt,
      userMessage,
      contract.temperature,
      contract.max_tokens,
      apiKey
    );

    const result = parseAIResponse<any>(raw, REQUIRED_FIELDS.judiciary);
    if (!result.success) {
      console.error(`[Judiciary] Parse failed: ${result.error}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error(`[Judiciary] Call failed:`, err);
    return null; // fallback: law has no effect this tick
  }
}

export async function callMedia(
  input: {
    analyst_report: any | null;
    judiciary_interpretations: any[];
    political_statements: any[];
    active_events: any[];
    state_summary: any;
    player_names: Record<string, string>;
  },
  apiKey: string
): Promise<any | null> {
  const contract = AI_CONTRACTS.media;

  try {
    const userMessage = `TICK INPUT DATA:\n${JSON.stringify(input, null, 2)}\n\nAnalyze and respond with valid JSON only.`;
    const raw = await callClaude(
      contract.system_prompt,
      userMessage,
      contract.temperature,
      contract.max_tokens,
      apiKey
    );

    const result = parseAIResponse<any>(raw, REQUIRED_FIELDS.media);
    if (!result.success) {
      console.error(`[Media] Parse failed: ${result.error}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error(`[Media] Call failed:`, err);
    return null; // fallback: placeholder headlines
  }
}

export async function callPoliticalReaction(
  input: {
    media: any | null;
    analyst_report: any | null;
    active_laws: any[];
    economic_indicators: any;
    current_approval: any;
    existing_movements: any[];
    protest_pressure: number;
    recent_events: any[];
    tick_history_summary: string | null;
  },
  apiKey: string
): Promise<any | null> {
  const contract = AI_CONTRACTS.political_reaction;

  try {
    const userMessage = `TICK INPUT DATA:\n${JSON.stringify(input, null, 2)}\n\nAnalyze and respond with valid JSON only.`;
    const raw = await callClaude(
      contract.system_prompt,
      userMessage,
      contract.temperature,
      contract.max_tokens,
      apiKey
    );

    const result = parseAIResponse<any>(raw, REQUIRED_FIELDS.political_reaction);
    if (!result.success) {
      console.error(`[Political Reaction] Parse failed: ${result.error}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error(`[Political Reaction] Call failed:`, err);
    return null; // fallback: -1 all approvals, +0.02 protest
  }
}

export async function callCrisis(
  input: {
    analyst_report: any | null;
    political_output: any | null;
    state_summary: any;
    suppressed_warnings: string[];
    player_behavior_patterns: string | null;
  },
  apiKey: string
): Promise<any | null> {
  const contract = AI_CONTRACTS.crisis;

  try {
    const userMessage = `TICK INPUT DATA:\n${JSON.stringify(input, null, 2)}\n\nAnalyze and respond with valid JSON only.`;
    const raw = await callClaude(
      contract.system_prompt,
      userMessage,
      contract.temperature,
      contract.max_tokens,
      apiKey
    );

    // Crisis can return null legitimately
    const result = parseAIResponse<any>(raw, REQUIRED_FIELDS.crisis);
    if (result.data === null) return null; // no crisis needed
    if (!result.success) {
      console.error(`[Crisis] Parse failed: ${result.error}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error(`[Crisis] Call failed:`, err);
    return null; // fallback: no crisis injected
  }
}

export async function callHistorian(
  input: {
    state: any;
    tick_events: any[];
    ai_outputs: any;
    previous_eras: any[];
    previous_reputations: any;
    active_player_actions: Record<string, string[]>;
  },
  apiKey: string
): Promise<any | null> {
  const contract = AI_CONTRACTS.historian;

  try {
    const userMessage = `TICK INPUT DATA:\n${JSON.stringify(input, null, 2)}\n\nAnalyze and respond with valid JSON only.`;
    const raw = await callClaude(
      contract.system_prompt,
      userMessage,
      contract.temperature,
      contract.max_tokens,
      apiKey
    );

    const result = parseAIResponse<any>(raw, REQUIRED_FIELDS.historian);
    if (!result.success) {
      console.error(`[Historian] Parse failed: ${result.error}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.error(`[Historian] Call failed:`, err);
    return null; // fallback: no historical record this tick
  }
}

// ============================================================================
// BUILD AISystemRegistry FOR CORE ENGINE
// ============================================================================
// Returns an object matching the AISystemRegistry interface from core-engine.ts
// that the processTick() function expects.

export function buildAIRegistry(apiKey: string) {
  return {
    stateAnalyst: async (input: { state: any; actions: any[] }) => {
      const result = await callStateAnalyst(input, apiKey);
      if (!result) {
        // Return minimal valid output so engine can continue
        return {
          trends: [],
          risks: [],
          projections: {
            gdp_3tick: input.state.economy.gdp,
            inflation_3tick: input.state.economy.inflation,
            unemployment_3tick: input.state.economy.unemployment,
            stability_3tick: input.state.society.stability,
          },
          confidence: 0,
        };
      }
      return result;
    },

    judiciary: async (input: { law: any; state: any }) => {
      const activeLaws = input.state.laws.filter(
        (l: any) => l.status === "active" && l.id !== input.law.id
      );
      const stateSummary = {
        gdp: input.state.economy.gdp,
        inflation: input.state.economy.inflation,
        unemployment: input.state.economy.unemployment,
        tax_rate: input.state.economy.tax_rate,
        stability: input.state.society.stability,
        public_trust: input.state.society.public_trust,
        budget_reserves: input.state.economy.budget.reserves,
      };

      const result = await callJudiciary(
        { law: input.law, active_laws: activeLaws, state_summary: stateSummary },
        apiKey
      );
      if (!result) {
        // Return no-op interpretation
        return {
          law_id: input.law.id,
          interpretation: "Law text under review. No implementation this cycle.",
          ambiguities: ["Pending judicial review"],
          implementation: { affected_variables: [], modifiers: [] },
        };
      }
      return result;
    },

    media: async (input: {
      analyst: any;
      judiciary: any[];
      state: any;
    }) => {
      // Build Media AI input from contract spec
      const politicalStatements: any[] = [];
      const playerNames: Record<string, string> = {};

      for (const [id, player] of Object.entries(input.state.players) as any[]) {
        playerNames[id] = player.name;
        if (player.role === "politician" && player.role_data?.politician?.public_statements) {
          for (const stmt of player.role_data.politician.public_statements) {
            politicalStatements.push({
              player_id: id,
              player_name: player.name,
              tick: stmt.tick,
              text: stmt.text,
            });
          }
        }
      }

      const activeEvents = input.state.events
        .filter((e: any) => e.status === "applied" && e.tick === input.state.meta.tick)
        .map((e: any) => ({
          type: e.type,
          severity: e.severity,
          description: e.description,
          narrative_hook: e.narrative_hook ?? "",
        }));

      const gdpDelta = input.state.economy.gdp_delta;
      const gdpTrend =
        gdpDelta > 5 ? "up" : gdpDelta < -5 ? "down" : "stable";

      const mediaInput = {
        analyst_report: input.analyst ?? null,
        judiciary_interpretations: input.judiciary.map((j: any) => ({
          law_id: j.law_id,
          interpretation: j.interpretation,
          ambiguities: j.ambiguities,
          severity: j.severity_assessment ?? 1,
        })),
        political_statements: politicalStatements,
        active_events: activeEvents,
        state_summary: {
          gdp_trend: gdpTrend,
          inflation: input.state.economy.inflation,
          unemployment: input.state.economy.unemployment,
          stability: input.state.society.stability,
          shortage: input.state.economy.market.shortage,
          protest_pressure: input.state.society.protest_pressure,
          approval_overall: input.state.government.approval.overall,
        },
        player_names: playerNames,
      };

      const result = await callMedia(mediaInput, apiKey);
      if (!result) {
        // Fallback placeholder
        return {
          headlines: [
            {
              text: "No news reports available this cycle.",
              bias: "neutral",
              truth_score: 1.0,
              source_event_id: null,
            },
            {
              text: "Communications disrupted — details unclear.",
              bias: "neutral",
              truth_score: 0.5,
              source_event_id: null,
            },
          ],
          articles: [],
          rumors: [],
        };
      }
      return result;
    },

    politicalReaction: async (input: {
      media: any;
      analyst: any;
      state: any;
    }) => {
      const polInput = {
        media: input.media ?? null,
        analyst_report: input.analyst ?? null,
        active_laws: input.state.laws
          .filter((l: any) => l.status === "active")
          .map((l: any) => ({
            id: l.id,
            original_text: l.original_text,
            status: l.status,
          })),
        economic_indicators: {
          inflation: input.state.economy.inflation,
          unemployment: input.state.economy.unemployment,
          shortage: input.state.economy.market.shortage,
          price_trend:
            input.state.economy.market.price_index > 1.05
              ? "up"
              : input.state.economy.market.price_index < 0.95
              ? "down"
              : "stable",
        },
        current_approval: input.state.government.approval,
        existing_movements: input.state.society.movements.map((m: any) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          strength: m.strength,
        })),
        protest_pressure: input.state.society.protest_pressure,
        recent_events: input.state.events
          .filter(
            (e: any) =>
              e.status === "applied" &&
              e.tick >= input.state.meta.tick - 2
          )
          .map((e: any) => ({
            type: e.type,
            severity: e.severity,
            narrative_hook: e.narrative_hook ?? "",
          })),
        tick_history_summary: null,
      };

      const result = await callPoliticalReaction(polInput, apiKey);
      if (!result) {
        // Fallback: slight decay
        return {
          approval_delta: { overall: -1, citizens: -1, business: -1, elite: -1 },
          protest_prob: Math.min(
            1,
            input.state.society.protest_pressure + 0.02
          ),
          movements: [],
          suppressed_warnings: [],
          public_mood: "cautious",
        };
      }
      return result;
    },

    crisis: async (input: {
      analyst: any;
      political: any;
      state: any;
    }) => {
      // Build stability/gdp history from tick_log
      const stabilityHistory = input.state.tick_log
        .slice(-5)
        .map(() => input.state.society.stability); // simplified — would need snapshots
      const gdpHistory = input.state.tick_log
        .slice(-5)
        .map(() => input.state.economy.gdp);

      // Find top player influence
      let topInfluence = 0;
      for (const player of Object.values(input.state.players) as any[]) {
        if (player.hidden_stats?.influence > topInfluence) {
          topInfluence = player.hidden_stats.influence;
        }
      }

      const crisisInput = {
        analyst_report: input.analyst ?? null,
        political_output: input.political ?? null,
        state_summary: {
          stability: input.state.society.stability,
          stability_history_5: stabilityHistory,
          gdp: input.state.economy.gdp,
          gdp_history_5: gdpHistory,
          radicalization: input.state.society.radicalization,
          protest_pressure: input.state.society.protest_pressure,
          active_crisis_count: input.state.events.filter(
            (e: any) => e.status === "applied" && e.severity >= 4
          ).length,
          tick: input.state.meta.tick,
          top_player_influence: topInfluence,
        },
        suppressed_warnings: input.political?.suppressed_warnings ?? [],
        player_behavior_patterns: null,
      };

      return callCrisis(crisisInput, apiKey);
    },

    historian: async (input: { state: any; tick_events: any[] }) => {
      // Build active player actions map
      const activePlayerActions: Record<string, string[]> = {};
      for (const [id, player] of Object.entries(input.state.players) as any[]) {
        const lastHistory = player.actions_history?.[player.actions_history.length - 1];
        if (lastHistory && lastHistory.tick === input.state.meta.tick) {
          activePlayerActions[id] = lastHistory.actions.map(
            (a: any) => a.action_type
          );
        }
      }

      const historianInput = {
        state: input.state,
        tick_events: input.tick_events,
        ai_outputs: {}, // filled by processTick before call
        previous_eras: input.state.history?.eras ?? [],
        previous_reputations: input.state.history?.player_reputations ?? {},
        active_player_actions: activePlayerActions,
      };

      const result = await callHistorian(historianInput, apiKey);
      return result;
    },
  };
}
