"use client";

// Everything the install tab needs to hand the snippet to somebody else: the
// per-platform guides, the shared copy control, and the text that both the
// mailto share and the clipboard button send. The guides are documentation, not
// an integration -- installing a script tag happens on the customer's own host,
// so nothing here calls the API.

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight, Clipboard, Copy, Info, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBusyAction } from "@/lib/busy-action";
import { cn } from "@/lib/utils";

export type CopyState = "idle" | "copied" | "failed";

// A copy that admits when it did not happen. navigator.clipboard is undefined on
// an insecure origin and rejects when the permission is denied; both used to
// leave the button claiming success, so a failure now keeps the text around for
// the person to select by hand.
export function useCopyText() {
  const action = useBusyAction();
  const [state, setState] = useState<CopyState>("idle");
  const [pendingText, setPendingText] = useState("");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const copy = (text: string) => action.run(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setState("copied");
      setPendingText("");
      timer.current = window.setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("failed");
      setPendingText(text);
    }
  });

  return { busy: action.busy, state, pendingText, copy };
}

export type CopyText = ReturnType<typeof useCopyText>;

// The live region stays mounted so the outcome is announced, rather than
// appearing as a new node assistive tech may never visit.
export function CopyStatus({ copy, subject, className }: { copy: CopyText; subject: string; className?: string }) {
  const fallbackID = useId();
  const fallback = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (copy.state === "failed") { fallback.current?.focus(); fallback.current?.select(); } }, [copy.state]);
  return (
    <>
      <p role="status" className={cn("mt-2 min-h-4 text-[10px] font-medium text-slate-500", className)}>
        {copy.state === "copied" ? "Copied to your clipboard." : copy.state === "failed" ? "Your browser blocked the copy. Select the text below and copy it by hand." : ""}
      </p>
      {copy.state === "failed" ? (
        <>
          <label htmlFor={fallbackID} className="sr-only">{subject} to copy by hand</label>
          <textarea id={fallbackID} ref={fallback} readOnly value={copy.pendingText} rows={5} className="mt-1 w-full resize-y rounded-lg border bg-white p-2 font-mono text-[10px] leading-5 text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300" />
        </>
      ) : null}
    </>
  );
}

export function SnippetBlock({ code, blocked, blockedLabel }: { code: string; blocked?: boolean; blockedLabel?: string }) {
  const copy = useCopyText();
  return (
    <div>
      <div className="relative overflow-hidden rounded-xl bg-slate-950 p-4 pt-12 sm:pt-4">
        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-6 text-slate-300"><code>{code}</code></pre>
        <Button size="sm" variant="secondary" className="absolute right-3 top-3 h-7 bg-white/10 text-[10px] text-white hover:bg-white/20" disabled={blocked} loading={copy.busy} loadingLabel="Copying the snippet" onClick={() => void copy.copy(code)}>
          {copy.state === "copied" ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          {blocked ? blockedLabel || "Not ready" : copy.state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <CopyStatus copy={copy} subject="Embed snippet" />
    </div>
  );
}

// The sentence every guide ends on. Republishing the host site is the step
// people skip before reporting that the widget never appeared.
const publishStep = "Publish your site, then reload it and look for the launcher in the corner.";

type PlatformGuide = { id: string; name: string; mark: string; blurb: string; steps: string[]; caveat?: string; wide?: boolean };

// Menu labels move between releases of every builder here, so wherever the exact
// path is the part that goes stale a step names the panel by what it does -- the
// site-wide custom-code or footer field -- instead of a route through the UI.
const platformGuides: PlatformGuide[] = [
  {
    id: "webflow",
    name: "Webflow",
    mark: "Wf",
    blurb: "Site-wide footer code",
    steps: [
      "Open the project, then its site settings, and find the custom code panel (older projects reach the same screen through project settings).",
      "Paste the snippet into the footer code box -- the field Webflow injects before </body> on every page. Do not use a single page's own custom code: that covers only that one page.",
      "Save the settings.",
      publishStep,
    ],
    caveat: "Webflow serves site-wide custom code only on paid Site plans, and never inside the Designer canvas or preview, so the launcher shows up on the published site only.",
  },
  {
    id: "wordpress",
    name: "WordPress",
    mark: "Wp",
    blurb: "Footer snippet on every page",
    steps: [
      "Sign in to your WordPress admin at /wp-admin as an administrator.",
      "Install and activate a header-and-footer snippet plugin. A plugin survives theme updates; a hand-edited theme file is replaced by the next one.",
      "Create a snippet, paste the code into the plugin's footer or \"before </body>\" box, and set it to run site-wide rather than on selected pages.",
      "Save and activate the snippet. If your theme or host already offers its own custom-code or footer-scripts field, that works just as well.",
      "Purge the cache if a caching plugin or a host-level cache sits in front of the site, otherwise the old footer keeps being served.",
      publishStep,
    ],
    caveat: "Self-hosted WordPress can do this on any host. WordPress.com allows plugins and custom scripts only on its higher plans.",
  },
  {
    id: "shopify",
    name: "Shopify",
    mark: "Sh",
    blurb: "theme.liquid, before </body>",
    steps: [
      "In the Shopify admin, open Online Store, then Themes.",
      "Duplicate the live theme first if you want a one-click rollback, then open that theme's actions menu and choose Edit code.",
      "Open layout/theme.liquid, paste the snippet immediately before the closing </body> tag, and save. theme.liquid wraps every storefront page, so one paste covers the whole store.",
      publishStep,
    ],
    caveat: "Theme code does not run on Shopify's checkout pages, so the launcher appears across the storefront but not during checkout.",
  },
  {
    id: "framer",
    name: "Framer",
    mark: "Fr",
    blurb: "End of the body tag",
    steps: [
      "Open the project's site settings and find its custom code panel, where the head and body injection fields live.",
      "Paste the snippet into the \"End of <body> tag\" field so it is injected on every page of the site.",
      "Save the settings.",
      publishStep,
    ],
    caveat: "Framer runs custom code on the published site only -- not on the canvas and not in preview -- and only on paid site plans.",
  },
  {
    id: "html",
    name: "Any website / HTML",
    mark: "</>",
    blurb: "Hand-written sites and frameworks",
    steps: [
      "Open the one template every page shares: index.html on a single-page site, or the shared layout -- app/layout.tsx in Next.js, a layout component in Astro or Nuxt, _layouts/default.html in Jekyll, the base template in Django or Rails.",
      "Paste the snippet immediately before the closing </body> tag. If the framework has a dedicated end-of-body or scripts slot, use that so the tag renders exactly once per page.",
      "If the site sends a Content-Security-Policy header, allow the snippet's script origin in script-src, or the browser blocks the file before it runs.",
      "Deploy the change.",
      publishStep,
    ],
    wide: true,
  },
];

export const shareSubject = "Install the Garuda chat widget on our website";

// One text for the mailto body and for the clipboard, so a teammate who was
// emailed the steps and one who was pasted them read the same thing.
export function installInstructions(embedCode: string, domains: string[]): string {
  return [
    "Hi -- could you add our Garuda chat widget to our website?",
    "",
    "Paste this snippet immediately before the closing </body> tag of the site-wide template, so it loads on every page:",
    "",
    embedCode,
    "",
    "Notes:",
    "- It belongs in the shared layout, footer, or custom-code area, not on one page.",
    "- It loads asynchronously, so it will not block the page rendering.",
    domains.length
      ? `- The widget starts only on the agent's approved domains: ${domains.join(", ")}. On any other origin it refuses to load.`
      : "- The widget starts only on the agent's approved domains, and none are approved yet. Tell me which domain you install it on so I can approve it, or it will refuse to load.",
    `- ${publishStep}`,
    "",
    "Thanks!",
  ].join("\n");
}

export function PlatformGuides({ embedCode, published, domains }: { embedCode: string; published: boolean; domains: string[] }) {
  const [openID, setOpenID] = useState("");
  const guide = platformGuides.find((platform) => platform.id === openID) || null;
  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {platformGuides.map((platform) => (
          <button key={platform.id} type="button" onClick={() => setOpenID(platform.id)} className={cn("flex items-center rounded-xl border p-3 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300", platform.wide && "sm:col-span-2")}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-700">{platform.mark}</span>
            <span className="ml-3 min-w-0"><span className="block text-xs font-semibold text-slate-700">{platform.name}</span><span className="block truncate text-[9px] text-slate-400">{platform.blurb}</span></span>
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
          </button>
        ))}
      </div>
      <Dialog open={Boolean(guide)} onOpenChange={(open) => { if (!open) setOpenID(""); }}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          {guide ? <GuideBody guide={guide} embedCode={embedCode} published={published} domains={domains} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function GuideBody({ guide, embedCode, published, domains }: { guide: PlatformGuide; embedCode: string; published: boolean; domains: string[] }) {
  const ready = published && domains.length > 0;
  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Install Garuda on {guide.name}</DialogTitle>
        <DialogDescription>{guide.blurb}. The snippet goes in one site-wide place so it loads on every page, not only the page you paste it into.</DialogDescription>
      </DialogHeader>
      <div className={cn("rounded-xl border p-3 text-[10px] leading-5", ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
        <p className="font-semibold">{ready ? "This agent is ready to install" : "Two things have to be true first"}</p>
        <ul className="mt-1 list-disc space-y-0.5 break-words pl-4">
          <li>{published ? "The agent is published, so its snippet serves a live widget." : "Publish the agent. Until then its snippet has nothing to load."}</li>
          <li>{domains.length ? `Approved domains: ${domains.join(", ")}. Install it on one of those; the widget refuses every other origin.` : "Add the site's domain to the agent's allowed domains in its Appearance settings, or the widget will refuse to load there."}</li>
        </ul>
      </div>
      <SnippetBlock code={embedCode} blocked={!published} blockedLabel="Publish first" />
      <ol className="space-y-3">
        {guide.steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">{index + 1}</span>
            <span className="text-[11px] leading-5 text-slate-600">{step}</span>
          </li>
        ))}
      </ol>
      {guide.caveat ? <p className="flex gap-2 rounded-lg bg-slate-50 p-3 text-[10px] leading-5 text-slate-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{guide.caveat}</p> : null}
      <DialogFooter><DialogClose asChild><Button size="sm" variant="outline">Done</Button></DialogClose></DialogFooter>
    </>
  );
}

export function ShareInstallPanel({ embedCode, published, domains }: { embedCode: string; published: boolean; domains: string[] }) {
  const copy = useCopyText();
  const instructions = installInstructions(embedCode, domains);
  const mailto = `mailto:?subject=${encodeURIComponent(shareSubject)}&body=${encodeURIComponent(instructions)}`;
  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white"><Mail className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-indigo-950">Need a teammate to install it?</p>
          <p className="mt-1 text-[10px] leading-5 text-indigo-700">{published ? "Both buttons hand over the same note: the snippet, where it goes, why it has to be site-wide, and the domains it is allowed to run on." : "Publish this agent first. Until then there is no live snippet to hand over."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {published ? (
              <Button size="sm" variant="outline" className="border-indigo-200 bg-white text-indigo-700" asChild>
                <a href={mailto}><Mail className="mr-1.5 h-3.5 w-3.5" /> Email the install steps</a>
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="border-indigo-200 bg-white text-indigo-700" disabled><Mail className="mr-1.5 h-3.5 w-3.5" /> Email the install steps</Button>
            )}
            <Button size="sm" variant="ghost" className="text-indigo-700 hover:bg-white/70" disabled={!published} loading={copy.busy} loadingLabel="Copying the install instructions" onClick={() => void copy.copy(instructions)}>
              <Clipboard className="mr-1.5 h-3.5 w-3.5" /> {copy.state === "copied" ? "Instructions copied" : "Copy install instructions"}
            </Button>
          </div>
          <CopyStatus copy={copy} subject="Install instructions" className="text-indigo-700" />
        </div>
      </div>
    </div>
  );
}
