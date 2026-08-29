"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, MessageSquareText, Search, UsersRound } from "lucide-react";
import { stampFor, type WorkspaceEntry, type WorkspaceIndex } from "@/components/portal/workspace-index";
import { cn } from "@/lib/utils";

const kindIcon = { agent: Bot, conversation: MessageSquareText, lead: UsersRound };
const kindLabel = { agent: "Agent", conversation: "Conversation", lead: "Lead" };

const RESULT_LIMIT = 8;

/**
 * Header search over the workspace's own agents, conversations and leads.
 *
 * The lists are fetched once on first focus and then filtered in the browser,
 * which is what lets every keystroke answer immediately; the debounce below is
 * only there to keep the filter off the keystroke itself on a long list.
 */
export function WorkspaceSearch({ index }: { index: WorkspaceIndex }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // The shortcut hint differs per platform, so it is decided after mount rather
  // than during render, where the server's guess would not match the browser's.
  const [shortcut, setShortcut] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value.trim().toLowerCase()), 120);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    setShortcut(/mac|iphone|ipad/i.test(window.navigator.userAgent) ? "⌘K" : "Ctrl K");
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const results = useMemo(
    () => (query ? index.entries.filter((entry) => entry.haystack.includes(query)).slice(0, RESULT_LIMIT) : []),
    [index.entries, query],
  );

  useEffect(() => { setActive(0); }, [query]);

  function go(entry: WorkspaceEntry) {
    setOpen(false);
    setValue("");
    setQuery("");
    inputRef.current?.blur();
    router.push(entry.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setValue("");
      inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!results.length) return;
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length);
      return;
    }
    if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active]);
    }
  }

  return (
    <div
      className="relative hidden max-w-sm flex-1 sm:block"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    >
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => { setValue(event.target.value); setOpen(true); index.load(); }}
        onFocus={() => { setOpen(true); index.load(); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label="Search agents, conversations and leads"
        aria-expanded={open}
        aria-controls={panelId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length ? `${panelId}-${active}` : undefined}
        placeholder="Search agents, conversations and leads…"
        className="h-9 w-full rounded-lg border-0 bg-slate-100/80 pl-9 pr-16 text-xs outline-none ring-indigo-500/20 transition placeholder:text-slate-400 focus:ring-2 focus-visible:ring-2"
      />
      {shortcut && !value && <kbd className="pointer-events-none absolute right-2.5 top-[9px] rounded border border-slate-300 bg-white px-1.5 py-px text-[9px] font-medium text-slate-500">{shortcut}</kbd>}
      {open && (
        <div id={panelId} className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-soft">
          {index.status === "loading" && <p role="status" className="px-2.5 py-3 text-[11px] text-slate-500">Loading your workspace…</p>}
          {index.status === "error" && (
            <div className="flex items-center justify-between gap-3 px-2.5 py-2.5">
              <p role="status" className="text-[11px] text-slate-600">The workspace could not be searched.</p>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={index.reload} className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button>
            </div>
          )}
          {index.status !== "loading" && index.status !== "error" && !query && <p className="px-2.5 py-3 text-[11px] text-slate-500">Type a name, message or email address to search this workspace.</p>}
          {index.status === "ready" && query && !results.length && <p role="status" className="px-2.5 py-3 text-[11px] text-slate-500">No agents, conversations or leads match “{value.trim()}”.</p>}
          {index.status === "ready" && Boolean(results.length) && (
            <ul role="listbox" aria-label="Workspace search results" className="max-h-[19rem] overflow-y-auto">
              {results.map((entry, position) => {
                const Icon = kindIcon[entry.kind];
                return (
                  <li
                    key={entry.key}
                    id={`${panelId}-${position}`}
                    role="option"
                    aria-selected={position === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(position)}
                    onClick={() => go(entry)}
                    className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2", position === active ? "bg-indigo-50" : "hover:bg-slate-50")}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-slate-900">{entry.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">{kindLabel[entry.kind]} · {entry.subtitle}</span>
                    </span>
                    <span className="shrink-0 text-[9px] text-slate-400">{stampFor(entry)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
