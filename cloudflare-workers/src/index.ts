// ============================================================================
// They Voted For This — Worker Entry Point
// ============================================================================
// Routes HTTP requests to the appropriate Durable Object instance.
// Each game server is a Durable Object with its own state.
// ============================================================================

import { GameServer } from "./game-server";
import { Env } from "./types";

export { GameServer };

// ============================================================================
// CORS
// ============================================================================

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function corsResponse(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function jsonResponse(data: any, status: number = 200): Response {
  return corsResponse(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================================================
// ROUTE MATCHING
// ============================================================================

interface RouteMatch {
  params: Record<string, string>;
}

function matchRoute(
  pathname: string,
  pattern: string
): RouteMatch | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return { params };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    try {
      // ---- Health check ----
      if (pathname === "/" || pathname === "/health") {
        return jsonResponse({
          game: "They Voted For This",
          status: "running",
          timestamp: new Date().toISOString(),
        });
      }

      // ---- Create server ----
      // POST /server/create
      if (method === "POST" && pathname === "/server/create") {
        const body = await request.json() as any;
        const { playerName, playerRole } = body;

        if (!playerName || !playerRole) {
          return errorResponse("Missing playerName or playerRole");
        }
        if (!["citizen", "business_owner", "politician"].includes(playerRole)) {
          return errorResponse("Invalid role. Must be: citizen, business_owner, politician");
        }

        // Create a new Durable Object with random ID
        const serverId = env.GAME_SERVER.newUniqueId();
        const stub = env.GAME_SERVER.get(serverId);

        // Forward to DO — it handles initialization + first player
        const doRequest = new Request("http://internal/initialize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerName,
            playerRole,
            tickIntervalHours: parseInt(env.TICK_INTERVAL_HOURS),
            maxPlayers: parseInt(env.MAX_PLAYERS_PER_SERVER),
            claudeApiKey: env.CLAUDE_API_KEY,
          }),
        });

        const doResponse = await stub.fetch(doRequest);
        const result = await doResponse.json() as any;

        return jsonResponse({
          ...result,
          serverId: serverId.toString(),
        }, doResponse.status);
      }

      // ---- Server-scoped routes ----
      // All require :id param

      // POST /server/:id/join
      const joinMatch = matchRoute(pathname, "/server/:id/join");
      if (method === "POST" && joinMatch) {
        const body = await request.json() as any;
        const stub = getServerStub(env, joinMatch.params.id);

        const doRequest = new Request("http://internal/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...body,
            claudeApiKey: env.CLAUDE_API_KEY,
          }),
        });
        const doResponse = await stub.fetch(doRequest);
        const result = await doResponse.json();
        return jsonResponse(result, doResponse.status);
      }

      // GET /server/:id/view?playerId=...&token=...
      const viewMatch = matchRoute(pathname, "/server/:id/view");
      if (method === "GET" && viewMatch) {
        const playerId = url.searchParams.get("playerId");
        const token = url.searchParams.get("token");

        if (!playerId || !token) {
          return errorResponse("Missing playerId or token query params");
        }

        const stub = getServerStub(env, viewMatch.params.id);
        const doRequest = new Request(
          `http://internal/view?playerId=${playerId}&token=${token}`
        );
        const doResponse = await stub.fetch(doRequest);
        const result = await doResponse.json();
        return jsonResponse(result, doResponse.status);
      }

      // POST /server/:id/action
      const actionMatch = matchRoute(pathname, "/server/:id/action");
      if (method === "POST" && actionMatch) {
        const body = await request.json() as any;
        const stub = getServerStub(env, actionMatch.params.id);

        const doRequest = new Request("http://internal/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const doResponse = await stub.fetch(doRequest);
        const result = await doResponse.json();
        return jsonResponse(result, doResponse.status);
      }

      // GET /server/:id/status
      const statusMatch = matchRoute(pathname, "/server/:id/status");
      if (method === "GET" && statusMatch) {
        const stub = getServerStub(env, statusMatch.params.id);
        const doRequest = new Request("http://internal/status");
        const doResponse = await stub.fetch(doRequest);
        const result = await doResponse.json();
        return jsonResponse(result, doResponse.status);
      }

      return errorResponse("Not found", 404);

    } catch (err) {
      console.error("Worker error:", err);
      return errorResponse(
        `Internal error: ${(err as Error).message}`,
        500
      );
    }
  },
};

// ============================================================================
// HELPERS
// ============================================================================

function getServerStub(env: Env, idString: string): DurableObjectStub {
  const id = env.GAME_SERVER.idFromString(idString);
  return env.GAME_SERVER.get(id);
}
