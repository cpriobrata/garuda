import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, authorizeInternal, json, validOpaqueKey, validUUID } from "../_shared/internal.ts";

const embeddings = new Supabase.ai.Session("gte-small");

type Payload = {
  organization_id?: string;
  agent_id?: string;
  query?: string;
  limit?: number;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await authorizeInternal(request))) return json({ error: "unauthorized" }, 401);

  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const organizationID = payload.organization_id;
  const agentID = payload.agent_id;
  const relationalMode = validUUID(organizationID) && validUUID(agentID);
  const runtimeMode = !validUUID(organizationID) && !validUUID(agentID) && validOpaqueKey(organizationID) && validOpaqueKey(agentID);
  if (!relationalMode && !runtimeMode) return json({ error: "invalid_resource_id" }, 422);

  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query || query.length > 4_000) return json({ error: "query_must_contain_1_to_4000_characters" }, 422);
  const limit = Math.min(Math.max(Number(payload.limit) || 4, 1), 8);

  try {
    const queryEmbedding = await embeddings.run(query, { mean_pool: true, normalize: true });
    const functionName = relationalMode ? "match_garuda_knowledge" : "match_garuda_runtime_knowledge";
    const parameters = relationalMode
      ? {
          query_organization_id: organizationID,
          query_agent_id: agentID,
          query_embedding: queryEmbedding,
          match_threshold: 0.55,
          match_count: limit,
        }
      : {
          query_organization_key: organizationID,
          query_agent_key: agentID,
          query_embedding: queryEmbedding,
          match_threshold: 0.55,
          match_count: limit,
        };
    const { data, error } = await adminClient().rpc(functionName, parameters);
    if (error) throw error;
    return json({ chunks: data ?? [], storage: relationalMode ? "relational" : "runtime_compat" });
  } catch (error) {
    console.error("RAG search failed", { agent_id: agentID, storage: relationalMode ? "relational" : "runtime_compat", error: error instanceof Error ? error.message : "unknown" });
    return json({ error: "search_failed" }, 500);
  }
});
