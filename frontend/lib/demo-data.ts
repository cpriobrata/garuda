export type AgentStatus = "live" | "draft" | "paused";

export type Agent = {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  type: "Sales" | "Support" | "Lead qualification";
  conversations: number;
  leads: number;
  conversionRate: number;
  channels: string[];
  color: string;
  lastActive: string;
};

export type Conversation = {
  id: string;
  visitor: string;
  initials: string;
  message: string;
  time: string;
  unread: number;
  status: "AI active" | "Needs you" | "Resolved" | "Lead captured";
  source: string;
  intent: string;
};

export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  score: number;
  status: "New" | "Qualified" | "Contacted" | "Meeting booked" | "Customer";
  source: string;
  captured: string;
  // The conversation this lead came out of, when there is one. Absent for a lead
  // somebody typed in by hand, which is why it is optional rather than empty.
  sessionId?: string;
};

export const agents: Agent[] = [
  {
    id: "aria-sales",
    name: "Aria",
    description: "Qualifies visitors, recommends the right plan, and books product demos.",
    status: "live",
    type: "Sales",
    conversations: 1284,
    leads: 218,
    conversionRate: 17.0,
    channels: ["Website", "WhatsApp"],
    color: "from-indigo-500 to-violet-600",
    lastActive: "Now",
  },
  {
    id: "kai-support",
    name: "Kai",
    description: "Answers product questions from your help center and routes complex issues.",
    status: "live",
    type: "Support",
    conversations: 847,
    leads: 74,
    conversionRate: 8.7,
    channels: ["Website"],
    color: "from-cyan-500 to-blue-600",
    lastActive: "2 min ago",
  },
  {
    id: "maya-concierge",
    name: "Maya",
    description: "A premium concierge for enterprise and high-intent visitors.",
    status: "draft",
    type: "Lead qualification",
    conversations: 0,
    leads: 0,
    conversionRate: 0,
    channels: ["Website"],
    color: "from-rose-400 to-orange-500",
    lastActive: "Edited yesterday",
  },
];

export const conversations: Conversation[] = [
  { id: "conv-1042", visitor: "Maya Chen", initials: "MC", message: "Thursday at 2 PM works perfectly. Can you send an invite?", time: "2m", unread: 2, status: "Needs you", source: "Pricing page", intent: "Book a demo" },
  { id: "conv-1041", visitor: "Ethan Brooks", initials: "EB", message: "Does the Growth plan support multiple websites?", time: "8m", unread: 0, status: "AI active", source: "Website", intent: "Plan question" },
  { id: "conv-1039", visitor: "Sofia Patel", initials: "SP", message: "Amazing, that answers everything. Thank you!", time: "24m", unread: 0, status: "Resolved", source: "Help center", intent: "Support" },
  { id: "conv-1037", visitor: "Marcus Reed", initials: "MR", message: "We get around 10k visitors each month and need Salesforce sync.", time: "41m", unread: 1, status: "Needs you", source: "Integrations", intent: "Enterprise" },
  { id: "conv-1033", visitor: "Anonymous visitor", initials: "AV", message: "How quickly can I add this to a Webflow site?", time: "1h", unread: 0, status: "AI active", source: "Homepage", intent: "Installation" },
  { id: "conv-1028", visitor: "Noah Williams", initials: "NW", message: "I will talk to my team and get back to you.", time: "3h", unread: 0, status: "Resolved", source: "Pricing page", intent: "Evaluation" },
];

export const leads: Lead[] = [
  { id: "lead-882", name: "Maya Chen", email: "maya@northstar.co", phone: "+1 415 555 0138", company: "Northstar Labs", score: 94, status: "Meeting booked", source: "Aria · Website", captured: "Today, 10:42" },
  { id: "lead-881", name: "Marcus Reed", email: "marcus@scaleup.io", phone: "+1 646 555 0183", company: "ScaleUp", score: 88, status: "Qualified", source: "Aria · Website", captured: "Today, 09:18" },
  { id: "lead-879", name: "Sofia Patel", email: "sofia@kinfolk.studio", phone: "+44 20 7946 0281", company: "Kinfolk Studio", score: 78, status: "New", source: "Kai · Website", captured: "Yesterday, 18:06" },
  { id: "lead-875", name: "Ethan Brooks", email: "ethan@atlasworks.com", phone: "+1 312 555 0104", company: "Atlas Works", score: 72, status: "Qualified", source: "Aria · WhatsApp", captured: "Yesterday, 14:22" },
  { id: "lead-868", name: "Noah Williams", email: "noah@brightpath.dev", phone: "+61 2 5550 0142", company: "BrightPath", score: 61, status: "New", source: "Aria · Website", captured: "Aug 27, 11:51" },
  { id: "lead-852", name: "Amelia Stone", email: "amelia@monoandco.com", phone: "+1 212 555 0129", company: "Mono & Co", score: 97, status: "Customer", source: "Aria · Website", captured: "Aug 24, 16:34" },
];

export const chartData = [28, 34, 31, 45, 48, 43, 59, 63, 58, 73, 78, 86, 82, 96];

export const chatTranscript = [
  { from: "agent", text: "Hi! I’m Aria from Acme. What brought you here today?" },
  { from: "visitor", text: "We need to turn more website traffic into demos." },
  { from: "agent", text: "I can help with that. About how many visitors do you get each month?" },
  { from: "visitor", text: "Around 8,000." },
  { from: "agent", text: "That’s a great fit for our Growth plan. Teams like yours typically lift qualified demos by 28%. Want to see it in action?" },
];
