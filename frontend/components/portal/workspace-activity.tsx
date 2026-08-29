"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bell, MessageSquareText, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { byNewest, stampFor, type WorkspaceIndex } from "@/components/portal/workspace-index";

const ACTIVITY_LIMIT = 6;

/**
 * The header bell: the newest leads and conversations the API has recorded.
 *
 * The server keeps no read state for a workspace, so the trigger carries no
 * badge. A dot here would be decoration pretending to be a count.
 */
export function WorkspaceActivityMenu({ index }: { index: WorkspaceIndex }) {
  const [open, setOpen] = useState(false);
  const recent = useMemo(
    () => index.entries.filter((entry) => entry.kind !== "agent").sort(byNewest).slice(0, ACTIVITY_LIMIT),
    [index.entries],
  );

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (next) index.load(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Recent activity"><Bell className="h-[18px] w-[18px] text-slate-600" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[19rem]">
        <DropdownMenuLabel>Recent activity</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {index.status === "loading" && <div role="group" className="px-2.5 py-3"><p className="text-[11px] text-slate-500">Loading recent activity…</p></div>}
        {index.status === "error" && <>
          <div role="group" className="px-2.5 pb-1 pt-2"><p className="text-[11px] text-slate-600">Recent activity could not be loaded.</p></div>
          <DropdownMenuItem className="text-[11px] font-semibold text-indigo-600" onSelect={(event) => { event.preventDefault(); index.reload(); }}>Try again</DropdownMenuItem>
        </>}
        {index.status === "ready" && !recent.length && <>
          <div role="group" className="px-2.5 pb-1 pt-2"><p className="text-[11px] font-semibold text-slate-700">No recent activity</p><p className="mt-1 text-[10px] leading-4 text-slate-500">Conversations and leads land here once a published agent is answering on your website.</p></div>
          <DropdownMenuItem asChild><Link href="/app/widget" className="text-[11px] font-semibold text-indigo-600">Install the widget</Link></DropdownMenuItem>
        </>}
        {index.status === "ready" && recent.map((entry) => (
          <DropdownMenuItem key={entry.key} asChild>
            <Link href={entry.href} className="gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">{entry.kind === "lead" ? <UsersRound className="h-3.5 w-3.5" /> : <MessageSquareText className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold text-slate-900">{entry.kind === "lead" ? "New lead" : "Conversation"} · {entry.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-slate-500">{entry.subtitle}</span>
              </span>
              <span className="shrink-0 text-[9px] text-slate-400">{stampFor(entry)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
