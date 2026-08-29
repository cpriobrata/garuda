import { cn } from "@/lib/utils";

type SectionTone = "default" | "muted" | "dark";

const toneClass: Record<SectionTone, string> = {
  default: "bg-white",
  muted: "border-y border-slate-100 bg-slate-50/70",
  dark: "bg-slate-950 text-white",
};

/**
 * One numbered-in-spirit chapter of a landing page. Every section owns exactly
 * one h2, which is what keeps the heading outline of these pages honest.
 */
export function Section({
  id,
  eyebrow,
  title,
  lede,
  tone = "default",
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lede?: string;
  tone?: SectionTone;
  children: React.ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <section id={id} className={cn("py-16 sm:py-20", toneClass[tone])}>
      <div className="container">
        <div className="max-w-3xl">
          {eyebrow && (
            <p className={cn("text-[11px] font-bold uppercase tracking-[.2em]", dark ? "text-indigo-300" : "text-indigo-600")}>
              {eyebrow}
            </p>
          )}
          <h2 className={cn("text-balance text-2xl font-bold tracking-[-0.035em] sm:text-4xl", eyebrow && "mt-3", dark ? "text-white" : "text-slate-950")}>
            {title}
          </h2>
          {lede && <p className={cn("mt-4 text-base leading-7 sm:text-lg sm:leading-8", dark ? "text-slate-300" : "text-slate-600")}>{lede}</p>}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** A body paragraph at the reading width the sections are set to. */
export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("max-w-3xl text-base leading-7 text-slate-600", className)}>{children}</p>;
}

/** A named observation: a short bolded claim followed by the reason it matters. */
export function PointGrid({ points }: { points: { title: string; body: string }[] }) {
  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {points.map((point) => (
        <li key={point.title} className="rounded-2xl border border-slate-200/80 bg-white p-6">
          <h3 className="text-base font-semibold tracking-tight text-slate-950">{point.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{point.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** An ordered set-up recipe. Numbers are decorative; the ol carries the order. */
export function StepList({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="rounded-2xl border border-slate-200/80 bg-white p-6">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-sm font-bold text-indigo-600" aria-hidden="true">
            {index + 1}
          </span>
          <h3 className="mt-4 text-base font-semibold tracking-tight text-slate-950">{step.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
