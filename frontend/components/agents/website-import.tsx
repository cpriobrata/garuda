"use client";

import { useState } from "react";
import { Globe, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiRequest } from "@/lib/api";
import { useBusyAction } from "@/lib/busy-action";

// Importing a page happens in two steps, and the second one is the point.
//
// The customer sees what was extracted BEFORE it becomes knowledge their agent
// answers from, because a page whose text came out as a cookie banner and a
// navigation menu is something they should be able to reject. Saving on their
// behalf would mean discovering that on a live website, in front of a visitor.

type ImportedPage = {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  characters: number;
};

// The server refuses a private, non-https or otherwise unreachable address. Its
// reason is deliberately vague about the network, and so is this: a message
// naming what is or is not reachable from the server would be a map of it.
function importFailureMessage(reason: unknown) {
  if (!(reason instanceof ApiError)) return "That page could not be imported. Check the address and try again.";
  switch (reason.code) {
    case "url_not_allowed":
      return "That address cannot be imported. Use a public https address on your own website.";
    case "subscription_required":
      return "Importing a website needs an active subscription.";
    case "agent_not_found":
      return "Save this agent first, then import a page into it.";
    case "rate_limited":
      return "That is a lot of imports in one hour. Try again shortly.";
    default:
      return reason.message || "That page could not be read.";
  }
}

export function WebsiteImport({
  agentId,
  onSave,
  blocked,
}: {
  agentId: string;
  onSave: (title: string, content: string) => Promise<boolean>;
  blocked: boolean;
}) {
  const [url, setUrl] = useState("");
  const [page, setPage] = useState<ImportedPage | null>(null);
  const [error, setError] = useState("");
  const importPage = useBusyAction();
  const savePage = useBusyAction();

  const canImport = Boolean(agentId) && url.trim().length > 0;

  return (
    <div className="space-y-2">
      <Label htmlFor="knowledge-url">Import a page from your website</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="knowledge-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="yourcompany.com/pricing"
          inputMode="url"
          autoComplete="url"
          aria-describedby="knowledge-url-hint"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (canImport && !importPage.busy) void runImport();
            }
          }}
        />
        <Button
          variant="outline"
          className="shrink-0"
          loading={importPage.busy}
          loadingLabel="Reading the page"
          disabled={!canImport || blocked}
          onClick={() => void runImport()}
        >
          <Globe className="mr-1.5 h-3.5 w-3.5" /> Import page
        </Button>
      </div>
      <p id="knowledge-url-hint" className="text-[10px] text-slate-400">
        {agentId
          ? "One page at a time. Import the pages that answer the questions customers actually ask — pricing, services, delivery, opening hours."
          : "Save this agent first, then import pages from your website."}
      </p>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] leading-4 text-red-700">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {page && (
        <div role="status" className="rounded-xl border bg-slate-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900">{page.title}</p>
              <p className="mt-0.5 break-all text-[10px] text-slate-500">{page.url}</p>
            </div>
            <span className="shrink-0 text-[10px] font-medium text-slate-500">
              {page.characters.toLocaleString()} characters
            </span>
          </div>

          {page.truncated && (
            <p className="mt-2 text-[10px] leading-4 text-amber-700">
              That page is long, so only the first part was imported. Import the rest as separate pages if it matters.
            </p>
          )}

          <p className="mt-2 text-[10px] font-medium text-slate-600">Check this reads like your website, not like its navigation menu:</p>
          {/* Its own scroll container: a long page must not push the builder's
              Save and Discard buttons off a phone screen. */}
          <pre className="mt-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-white p-2.5 text-[10px] leading-4 text-slate-600">
            {page.text}
          </pre>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={savePage.busy}
              loadingLabel="Saving the page"
              disabled={blocked}
              onClick={() =>
                savePage.run(async () => {
                  setError("");
                  try {
                    // onSave reports failure by returning false rather than
                    // throwing -- it handles its own errors -- so the fetched
                    // page is only discarded once it is actually stored.
                    if (await onSave(page.title, page.text)) {
                      setPage(null);
                      setUrl("");
                    } else {
                      setError("That page could not be saved. The text is still here — try again.");
                    }
                  } catch (reason) {
                    setError(reason instanceof ApiError ? reason.message : "That page could not be saved. Try again.");
                  }
                })
              }
            >
              <Check className="mr-1.5 h-3.5 w-3.5" /> Save as knowledge
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPage(null)} disabled={savePage.busy}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  function runImport() {
    return importPage.run(async () => {
      setError("");
      setPage(null);
      try {
        const imported = await apiRequest<ImportedPage>(`/agents/${encodeURIComponent(agentId)}/sources/fetch`, {
          method: "POST",
          // A bare domain is what a person types. The server adds the scheme, so
          // sending it as typed is deliberate rather than lax.
          body: JSON.stringify({ url: url.trim() }),
          // Longer than the server's own fetch budget. At the default eight
          // seconds the client gave up first on any slow-but-valid page, and
          // then told the customer their address was the problem.
          timeoutMs: 30_000,
        });
        setPage(imported);
      } catch (reason) {
        setError(importFailureMessage(reason));
      }
    });
  }
}
