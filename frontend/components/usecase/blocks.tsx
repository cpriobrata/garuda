import { AlertTriangle, Check, FileText, MessageSquareQuote, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The questions visitors really type, each paired with where the answer has to
 * come from. The pairing is the point: an agent can only answer what its owner
 * has given it, so a question with no source is a question it must decline.
 */
export function QuestionList({ items }: { items: { question: string; source: string }[] }) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => (
        <li key={item.question} className="rounded-2xl border border-slate-200/80 bg-white p-5">
          <p className="flex gap-2.5 text-sm font-semibold leading-6 text-slate-900">
            <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden="true" />
            <span>{item.question}</span>
          </p>
          <p className="mt-2 pl-[26px] text-sm leading-6 text-slate-600">
            <span className="font-medium text-slate-500">Answered from:</span> {item.source}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * How to spend the five knowledge sources an agent gets on the $17 plan. Each
 * card is one source; the list under it is what belongs inside that source.
 */
export function KnowledgeSources({ sources }: { sources: { title: string; contains: string[] }[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-2">
      {sources.map((source, index) => (
        <li key={source.title}>
          <Card className="h-full border-slate-200/80">
            <CardContent className="p-6">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
                  <FileText className="h-4 w-4" />
                </span>
                <p className="text-[11px] font-bold uppercase tracking-[.16em] text-slate-400">Source {index + 1}</p>
              </div>
              <h3 className="mt-4 text-base font-semibold tracking-tight text-slate-950">{source.title}</h3>
              <ul className="mt-3 space-y-2">
                {source.contains.map((line) => (
                  <li key={line} className="flex gap-2.5 text-sm leading-6 text-slate-600">
                    <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}

export type LeadField = {
  label: string;
  /** One of the field types the lead-form builder actually offers. */
  type: "text" | "email" | "telephone" | "number" | "textarea" | "select" | "checkbox" | "date";
  /** What a visitor plausibly puts in it. Illustrative, never a real person. */
  value: string;
  required?: boolean;
  /** Why this field is worth one of the twenty slots. */
  why?: string;
};

/**
 * An illustrative captured lead. Everything in it is invented on purpose and
 * labelled as such; the useful part is the shape, and that the field types are
 * the ones the builder really offers.
 */
export function LeadRecord({
  heading,
  fields,
  consentLine,
  note,
}: {
  heading: string;
  fields: LeadField[];
  consentLine: string;
  note: string;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,.85fr)] lg:gap-10">
      <Card className="overflow-hidden border-slate-200">
        <div className="flex items-center justify-between border-b bg-slate-50/80 px-5 py-3">
          <p className="text-sm font-semibold text-slate-900">{heading}</p>
          <Badge variant="secondary" className="shrink-0">Illustrative</Badge>
        </div>
        <CardContent className="p-0">
          <dl className="divide-y divide-slate-100">
            {fields.map((field) => (
              <div key={field.label} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] sm:items-baseline sm:gap-4">
                <dt className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                  {field.label}
                  {field.required && <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">required</span>}
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{field.type}</code>
                </dt>
                <dd className="text-sm font-medium text-slate-900">{field.value}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t bg-emerald-50/60 px-5 py-3.5 text-xs leading-5 text-emerald-900">
            <Check className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
            {consentLine}
          </p>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <p className="text-base leading-7 text-slate-600">{note}</p>
        <ul className="space-y-3">
          {fields
            .filter((field) => field.why)
            .map((field) => (
              <li key={field.label} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
                <p className="text-xs font-bold uppercase tracking-[.12em] text-slate-500">{field.label}</p>
                <p className="mt-1.5 text-sm leading-6 text-slate-600">{field.why}</p>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Things this kind of business must not let an agent do. Amber rather than red:
 * these are decisions the owner makes when configuring, not error states.
 */
export function Cautions({
  points,
  tone = "amber",
}: {
  points: { title: string; body: string }[];
  tone?: "amber" | "rose";
}) {
  const rose = tone === "rose";
  const Icon = rose ? ShieldAlert : AlertTriangle;
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {points.map((point) => (
        <li
          key={point.title}
          className={cn("rounded-2xl border p-6", rose ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60")}
        >
          <p className={cn("flex gap-2.5 text-base font-semibold tracking-tight", rose ? "text-rose-950" : "text-amber-950")}>
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", rose ? "text-rose-600" : "text-amber-600")} aria-hidden="true" />
            <span>{point.title}</span>
          </p>
          <p className={cn("mt-2 pl-[26px] text-sm leading-6", rose ? "text-rose-900/90" : "text-amber-900/90")}>{point.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Two columns: what the agent should answer, and what it must refuse. */
export function DoesRefuses({
  doesTitle,
  does,
  refusesTitle,
  refuses,
}: {
  doesTitle: string;
  does: string[];
  refusesTitle: string;
  refuses: string[];
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6">
        <h3 className="text-base font-semibold tracking-tight text-emerald-950">{doesTitle}</h3>
        <ul className="mt-4 space-y-3">
          {does.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-6 text-emerald-900">
              <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-6">
        <h3 className="text-base font-semibold tracking-tight text-rose-950">{refusesTitle}</h3>
        <ul className="mt-4 space-y-3">
          {refuses.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-6 text-rose-900">
              <X className="mt-1 h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * A block quoting instructions the owner would paste into the agent. Rendered
 * as a blockquote so it is unambiguous that these are words to copy, not a
 * promise about behaviour anyone has measured.
 */
export function InstructionSnippet({ label, lines }: { label: string; lines: string[] }) {
  return (
    <figure className="max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
      <figcaption className="border-b border-white/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[.16em] text-indigo-300">
        {label}
      </figcaption>
      <blockquote className="space-y-2.5 px-5 py-4">
        {lines.map((line) => (
          <p key={line} className="font-mono text-[13px] leading-6 text-slate-300">
            {line}
          </p>
        ))}
      </blockquote>
    </figure>
  );
}

/** A plain, unmissable statement of something the product does not do yet. */
export function NotBuiltYet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="max-w-3xl rounded-2xl border border-slate-300 bg-slate-100/70 p-6">
      <h3 className="text-sm font-bold uppercase tracking-[.14em] text-slate-500">{title}</h3>
      <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">{children}</div>
    </aside>
  );
}
