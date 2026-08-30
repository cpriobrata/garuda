"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Blocks,
  Bot,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Plus,
  Settings,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { WorkspaceActivityMenu } from "@/components/portal/workspace-activity";
import { useWorkspaceIndex } from "@/components/portal/workspace-index";
import { WorkspaceSearch } from "@/components/portal/workspace-search";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { clearAuthSession, garudaApi, hasAuthSession, onAuthSessionCleared } from "@/lib/api";
import { agents as demoAgents, type Agent } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

const nav = [
  { label: "Overview", href: "/app", icon: LayoutDashboard },
  { label: "Agents", href: "/app/agents", icon: Bot },
  { label: "Conversations", href: "/app/conversations", icon: MessageSquareText },
  { label: "Leads", href: "/app/leads", icon: UsersRound },
  { label: "Appointments", href: "/app/appointments", icon: CalendarClock },
  { label: "Widget", href: "/app/widget", icon: Inbox },
  { label: "Integrations", href: "/app/integrations", icon: Blocks },
];

const lowerNav = [
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Settings", href: "/app/settings", icon: Settings },
];

type Bootstrap = Awaited<ReturnType<typeof garudaApi.me>>;

export type PortalAccount = { name: string; email: string; organization: string; planStatus: string };

// "granted" is the only decision that renders the workspace. A bootstrap that
// did not arrive is never treated as permission to continue.
export type PortalAccess =
  | { state: "granted" }
  | { state: "redirect"; destination: string }
  | { state: "blocked" };

export function accountFromBootstrap(bootstrap: Bootstrap): PortalAccount {
  return {
    name: bootstrap.user.name?.trim() || bootstrap.user.email.split("@")[0] || "Account",
    email: bootstrap.user.email,
    organization: bootstrap.organization.name || "Workspace",
    planStatus: bootstrap.subscription.status,
  };
}

export function evaluatePortalAccess(bootstrap: Bootstrap, pathname: string): PortalAccess {
  if (!bootstrap.subscription.entitled) return { state: "redirect", destination: "/checkout" };
  if (bootstrap.onboarding.status !== "completed" && pathname !== "/app/onboarding" && pathname !== "/app/generating") {
    return { state: "redirect", destination: "/app/onboarding" };
  }
  return { state: "granted" };
}

// The entitlement decision rests on the bootstrap call alone. The agent list is
// only sidebar decoration, so losing it must never let an unchecked visitor in,
// and a bootstrap that failed blocks the workspace rather than opening it.
export async function resolvePortalAccess(pathname: string): Promise<{ access: PortalAccess; account: PortalAccount | null; agents: Agent[] | null }> {
  const [bootstrapResult, agentsResult] = await Promise.allSettled([garudaApi.me(), garudaApi.listAgents()]);
  const agents = agentsResult.status === "fulfilled" ? agentsResult.value : null;
  if (bootstrapResult.status !== "fulfilled") return { access: { state: "blocked" }, account: null, agents: null };
  return { access: evaluatePortalAccess(bootstrapResult.value, pathname), account: accountFromBootstrap(bootstrapResult.value), agents };
}

// The gate's own destination, and deliberately without the session=expired that
// lib/api.ts adds: nothing here was rejected by the server, there was simply no
// session to present.
function signInDestination(pathname: string) {
  return `/auth/sign-in?next=${encodeURIComponent(pathname)}`;
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const connected = Boolean(process.env.NEXT_PUBLIC_API_URL);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Shared by the header search and the activity bell: whichever the operator
  // opens first pays for the fetch and the other reads the same cached lists.
  const workspace = useWorkspaceIndex(connected);
  const [agentItems, setAgentItems] = useState<Agent[]>(connected ? [] : demoAgents);
  const [selectedAgentId, setSelectedAgentId] = useState(connected ? "" : demoAgents[0]?.id || "");
  // A connected workspace starts closed and only opens once the bootstrap call
  // confirms the account is entitled and past onboarding.
  const [access, setAccess] = useState<PortalAccess | null>(connected ? null : { state: "granted" });
  const [attempt, setAttempt] = useState(0);
  const [account, setAccount] = useState<PortalAccount>(
    connected
      ? { name: "Account", email: "", organization: "Workspace", planStatus: "" }
      : { name: "Maya Chen", email: "demo@garuda.ai", organization: "Northstar Labs", planStatus: "active" },
  );

  useEffect(() => {
    if (!connected) return;
    if (!hasAuthSession()) {
      setAccess({ state: "redirect", destination: signInDestination(pathname) });
      router.replace(signInDestination(pathname));
      return;
    }

    // The last decision is kept while a later check runs, so moving between
    // workspace pages does not blank the screen on every navigation.
    let active = true;
    resolvePortalAccess(pathname).then((resolved) => {
      if (!active) return;
      setAccess(resolved.access);
      if (resolved.access.state === "redirect") {
        router.replace(resolved.access.destination);
        return;
      }
      if (resolved.account) setAccount(resolved.account);
      if (resolved.agents) {
        setAgentItems(resolved.agents);
        setSelectedAgentId((current) => current || resolved.agents?.[0]?.id || "");
      }
    }).catch(() => {
      // An unreadable bootstrap is still an unanswered gate, so offer the
      // retry rather than leaving the workspace waiting forever.
      if (active) setAccess({ state: "blocked" });
    });
    return () => { active = false; };
  }, [attempt, connected, pathname, router]);

  // One session is now shared by every tab, so signing out in one of them has to
  // close this one as well rather than leave a workspace on screen that no
  // longer has a token behind it.
  useEffect(() => {
    if (!connected) return;
    return onAuthSessionCleared(() => {
      setAccess({ state: "redirect", destination: signInDestination(pathname) });
      router.replace(signInDestination(pathname));
    });
  }, [connected, pathname, router]);

  const selectedAgent = agentItems.find((item) => item.id === selectedAgentId) || agentItems[0];
  const accountInitials = account.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "A";

  if (!access) return <PortalGateNotice title="Checking your workspace access…" />;
  if (access.state === "redirect") return <PortalGateNotice title="Taking you to the right place…" />;
  if (access.state === "blocked") {
    return (
      <PortalGateNotice title="We could not confirm your workspace access." description="Garuda keeps the workspace closed until the server confirms your subscription. Check your connection and try again.">
        <div className="mt-5 flex justify-center gap-2">
          <Button size="sm" onClick={() => { setAccess(null); setAttempt((current) => current + 1); }}>Try again</Button>
          <Button variant="outline" size="sm" asChild><Link href="/auth/sign-in" onClick={clearAuthSession}>Sign out</Link></Button>
        </div>
      </PortalGateNotice>
    );
  }

  if (pathname === "/app/onboarding" || pathname === "/app/generating") return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#f7f8fb]">
      {mobileOpen && <button className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-[250px] flex-col border-r border-slate-200 bg-white transition-[transform,visibility] duration-200 lg:visible lg:translate-x-0", mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full")}>
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-5"><Brand href="/app" /><Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></Button></div>
        <div className="shrink-0 px-3 pt-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-xl border bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100">
                <span className={cn("grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br text-xs font-bold text-white", selectedAgent?.color || "from-slate-500 to-slate-700")}>{selectedAgent?.name?.[0]?.toUpperCase() || <Bot className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-900">{selectedAgent?.name || "No agents yet"}</span><span className={cn("mt-0.5 flex items-center gap-1 text-[10px]", selectedAgent?.status === "live" ? "text-emerald-600" : "text-slate-500")}><span className={cn("h-1.5 w-1.5 rounded-full", selectedAgent?.status === "live" ? "bg-emerald-500" : "bg-slate-300")} /> {selectedAgent ? (selectedAgent.status === "live" ? "Live" : "Draft") : "Create your first"}</span></span>
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[224px]" align="start">
              <DropdownMenuLabel>Open an agent</DropdownMenuLabel>
              {agentItems.length ? agentItems.map((agent) => <DropdownMenuItem key={agent.id} asChild><Link href={`/app/agents/${agent.id}`} onClick={() => { setSelectedAgentId(agent.id); setMobileOpen(false); }}><span className={cn("mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[10px] font-bold text-white", agent.color)}>{agent.name[0]?.toUpperCase()}</span><span className="min-w-0 flex-1 truncate">{agent.name}</span><span className={cn("ml-2 shrink-0 text-[10px] font-semibold", agent.status === "live" ? "text-emerald-600" : "text-slate-400")}>{agent.status === "live" ? "Live" : "Draft"}</span></Link></DropdownMenuItem>) : <DropdownMenuItem disabled>No agents in this workspace</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/app/agents/new"><Plus className="mr-2 h-4 w-4" /> New agent</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="mt-5 min-h-0 flex-1 space-y-1 overflow-y-auto px-3" aria-label="Workspace navigation">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Workspace</p>
          {nav.map((item) => <NavItem key={item.href} item={item} pathname={pathname} onNavigate={() => setMobileOpen(false)} />)}
          <p className="px-3 pb-2 pt-6 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Manage</p>
          {lowerNav.map((item) => <NavItem key={item.href} item={item} pathname={pathname} onNavigate={() => setMobileOpen(false)} />)}
        </nav>
        <div className="m-3 shrink-0 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-3.5">
          <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-white"><Sparkles className="h-3.5 w-3.5" /></span><p className="text-xs font-semibold text-indigo-950">Launch plan</p><Badge className="ml-auto bg-white text-[9px] text-indigo-700">{connected ? (account.planStatus || "Plan") : "Demo"}</Badge></div>
          {!connected && <><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-indigo-100"><div className="h-full w-[42%] rounded-full bg-indigo-600" /></div><p className="mt-2 text-[10px] text-indigo-700">42 of 100 demo conversations</p></>}
          {connected && <p className="mt-3 text-[10px] leading-4 text-indigo-700">Subscription and server-recorded usage are available in billing.</p>}
          <Link href="/app/billing" className="mt-2 inline-block text-[10px] font-semibold text-indigo-700 hover:underline">View billing →</Link>
        </div>
        <div className="shrink-0 border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50"><Avatar className="h-8 w-8"><AvatarFallback className="bg-slate-950 text-white">{accountInitials}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-900">{account.name}</span><span className="block truncate text-[10px] text-slate-500">{account.organization}</span></span><ChevronDown className="h-4 w-4 text-slate-400" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52"><DropdownMenuLabel>{account.email || "Authenticated account"}</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem asChild><Link href="/app/settings"><Settings className="mr-2 h-4 w-4" /> Account settings</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/help"><CircleHelp className="mr-2 h-4 w-4" /> Help centre</Link></DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-red-600" asChild><Link href="/auth/sign-in" onClick={clearAuthSession}><LogOut className="mr-2 h-4 w-4" /> Sign out</Link></DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="lg:pl-[250px]">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-slate-200 bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="mr-2 lg:hidden" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></Button>
          <WorkspaceSearch index={workspace} />
          <div className="ml-auto flex items-center gap-1.5">
            {!connected && <Badge variant="secondary" className="hidden text-[9px] sm:inline-flex">Demo workspace</Badge>}
            <WorkspaceActivityMenu index={workspace} />
            <Button size="sm" asChild><Link href="/app/agents/new"><Plus className="mr-1.5 h-3.5 w-3.5" /> <span className="hidden sm:inline">New agent</span><span className="sm:hidden">Agent</span></Link></Button>
          </div>
        </header>
        <main className="dashboard-height p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function PortalGateNotice({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f7f8fb] p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Brand href="/app" />
        <p className="mt-6 text-sm font-semibold text-slate-900">{title}</p>
        {description && <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>}
        {children}
      </div>
    </div>
  );
}

function NavItem({ item, pathname, onNavigate }: { item: { label: string; href: string; icon: React.ComponentType<{ className?: string }>; count?: number }; pathname: string; onNavigate: () => void }) {
  const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
  return <Link href={item.href} onClick={onNavigate} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition", active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}><item.icon className={cn("h-[18px] w-[18px]", active ? "text-indigo-600" : "text-slate-400")} /><span>{item.label}</span>{item.count ? <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-indigo-600 px-1 text-[9px] font-bold text-white">{item.count}</span> : null}</Link>;
}
