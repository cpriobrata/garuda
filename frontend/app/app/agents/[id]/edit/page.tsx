import { AgentBuilder } from "@/components/agents/agent-builder";

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentBuilder existing agentId={id} />;
}
