import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, authorizeInternal, json, validOpaqueKey, validUUID } from "../_shared/internal.ts";

const embeddings = new Supabase.ai.Session("gte-small");
const maximumSourceCharacters = 100_000;
const targetChunkCharacters = 1_700;
const overlapCharacters = 180;

type Payload = {
  action?: "ingest" | "delete";
  organization_id?: string;
  agent_id?: string;
  source_id?: string;
  name?: string;
  content?: string;
};

function chunksFor(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length && chunks.length < 80) {
    let end = Math.min(offset + targetChunkCharacters, normalized.length);
    if (end < normalized.length) {
      const paragraph = normalized.lastIndexOf("\n\n", end);
      const sentence = normalized.lastIndexOf(". ", end);
      const boundary = Math.max(paragraph, sentence);
      if (boundary > offset + targetChunkCharacters / 2) end = boundary + 1;
    }
    const chunk = normalized.slice(offset, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    offset = Math.max(offset + 1, end - overlapCharacters);
  }
  return chunks;
}

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
  const sourceID = payload.source_id;
  const uuidTenant = validUUID(organizationID) && validUUID(agentID);
  const relationalMode = uuidTenant && validUUID(sourceID);
  const runtimeMode = !uuidTenant && !validUUID(organizationID) && !validUUID(agentID) && validOpaqueKey(organizationID) && validOpaqueKey(agentID) && validOpaqueKey(sourceID);
  if (!relationalMode && !runtimeMode) return json({ error: "invalid_resource_id" }, 422);

  const database = adminClient();
  const sources = database.schema("app").from("knowledge_sources");
  const relationalChunks = database.schema("app").from("knowledge_chunks");
  const runtimeChunks = database.schema("app").from("rag_runtime_chunks");

  if (relationalMode) {
    const { data: source, error: sourceError } = await sources
      .select("id")
      .eq("organization_id", organizationID)
      .eq("agent_id", agentID)
      .eq("id", sourceID)
      .maybeSingle();
    if (sourceError) return json({ error: "source_lookup_failed" }, 500);
    if (!source) return json({ error: "source_not_found" }, 404);
  }

  if (payload.action === "delete") {
    const operation = relationalMode
      ? relationalChunks.delete().eq("organization_id", organizationID).eq("agent_id", agentID).eq("source_id", sourceID)
      : runtimeChunks.delete().eq("organization_key", organizationID).eq("agent_key", agentID).eq("source_key", sourceID);
    const { error } = await operation;
    if (error) return json({ error: "chunk_delete_failed" }, 500);
    return json({ status: "deleted", storage: relationalMode ? "relational" : "runtime_compat" });
  }

  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  const sourceName = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!content || content.length > maximumSourceCharacters) {
    return json({ error: "content_must_contain_1_to_100000_characters" }, 422);
  }
  if (!sourceName || sourceName.length > 200) return json({ error: "invalid_source_name" }, 422);
  const pieces = chunksFor(content);
  if (!pieces.length) return json({ error: "content_is_empty" }, 422);

  if (relationalMode) {
    await sources
      .update({ status: "processing", safe_error_code: null, safe_error_message: null })
      .eq("organization_id", organizationID)
      .eq("agent_id", agentID)
      .eq("id", sourceID);
  }

  try {
    const vectors: unknown[] = [];
    for (const piece of pieces) {
      vectors.push(await embeddings.run(piece, { mean_pool: true, normalize: true }));
    }

    if (relationalMode) {
      const records = pieces.map((piece, ordinal) => ({
        organization_id: organizationID,
        agent_id: agentID,
        source_id: sourceID,
        ordinal,
        content: piece,
        token_count: Math.ceil(piece.length / 4),
        metadata: { source_name: sourceName },
        embedding: vectors[ordinal],
      }));
      const { error: deleteError } = await relationalChunks
        .delete()
        .eq("organization_id", organizationID)
        .eq("agent_id", agentID)
        .eq("source_id", sourceID);
      if (deleteError) throw deleteError;
      const { error: insertError } = await relationalChunks.insert(records);
      if (insertError) throw insertError;
      const { error: readyError } = await sources
        .update({ status: "ready", safe_error_code: null, safe_error_message: null })
        .eq("organization_id", organizationID)
        .eq("agent_id", agentID)
        .eq("id", sourceID);
      if (readyError) throw readyError;
    } else {
      const records = pieces.map((piece, ordinal) => ({
        organization_key: organizationID,
        agent_key: agentID,
        source_key: sourceID,
        source_name: sourceName,
        ordinal,
        content: piece,
        token_count: Math.ceil(piece.length / 4),
        metadata: { repository: "file", source_name: sourceName },
        embedding: vectors[ordinal],
      }));
      const { error: deleteError } = await runtimeChunks
        .delete()
        .eq("organization_key", organizationID)
        .eq("agent_key", agentID)
        .eq("source_key", sourceID);
      if (deleteError) throw deleteError;
      const { error: insertError } = await runtimeChunks.insert(records);
      if (insertError) throw insertError;
    }

    return json({ status: "ready", chunks: pieces.length, storage: relationalMode ? "relational" : "runtime_compat" });
  } catch (error) {
    console.error("RAG ingestion failed", { source_id: sourceID, storage: relationalMode ? "relational" : "runtime_compat", error: error instanceof Error ? error.message : "unknown" });
    if (relationalMode) {
      await sources
        .update({ status: "failed", safe_error_code: "embedding_failed", safe_error_message: "Embedding generation failed; retry this source." })
        .eq("organization_id", organizationID)
        .eq("agent_id", agentID)
        .eq("id", sourceID);
    }
    return json({ error: "embedding_failed" }, 500);
  }
});
