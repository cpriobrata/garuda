import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        dark: "bg-slate-950 text-white shadow-sm hover:bg-slate-800",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-xl px-6 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  // Marks the button as performing an async action: it disables itself, shows a
  // spinner in place of its label, and reports aria-busy to assistive tech.
  loading?: boolean;
  // What the spinner means, announced to screen readers while the label is hidden.
  loadingLabel?: string;
}

// The same busy mark the Button paints, exported for the handful of controls
// that are not Buttons but still start an async action.
function Spinner({ className }: { className?: string }) {
  return (
    // The spin is the pleasant part, not the message: under prefers-reduced-motion
    // the ring stops but stays, so the busy state is still visible without motion.
    <svg className={cn("h-4 w-4 animate-spin motion-reduce:animate-none", className)} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, loading = false, loadingLabel = "Working", disabled, children, ...props }, ref) => {
  // A control's own descendants are presentational to assistive tech, so the
  // hidden label inside it is a NAME and nothing more -- it is read only if the
  // reader happens to visit the button, and a disabled button drops focus the
  // moment it goes busy. This region sits outside the control so the change is
  // spoken, and it is rendered while idle too: a live region inserted in the
  // same paint as its text is routinely read as nothing at all.
  const announcement = <span role="status" className="sr-only">{loading ? loadingLabel : ""}</span>;

  if (asChild) {
    // A Slot renders someone else's element -- usually a link -- so it takes the
    // busy flag but never the spinner, which would be a second child.
    //
    // An anchor has no disabled attribute, so the flag has to be expressed the way
    // assistive technology and CSS can both see. Dropping it silently, as this
    // branch did before, meant a disabled link stayed fully clickable.
    const inactive = disabled || loading;
    return (
      <>
        <Slot
          className={cn(buttonVariants({ variant, size, className }), inactive && "pointer-events-none opacity-50")}
          ref={ref}
          aria-busy={loading || undefined}
          aria-disabled={inactive || undefined}
          tabIndex={inactive ? -1 : undefined}
          {...props}
        >
          {children}
        </Slot>
        {announcement}
      </>
    );
  }

  return (
    <>
      <button
        className={cn(
          buttonVariants({ variant, size, className }),
          // The base disables pointer events while disabled, and an element that
          // takes no pointer events draws no cursor of its own -- the arrow the
          // person sees belongs to the page underneath. Handing them back is what
          // makes the busy cursor appear; the click stays swallowed either way,
          // because that is the disabled attribute's job and not the pointer's.
          loading && "relative cursor-progress disabled:pointer-events-auto disabled:opacity-100",
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading ? "true" : undefined}
        {...props}
      >
        {/* The label keeps its own space while it is hidden, so the button is
            exactly as wide working as it is idle and nothing around it moves. */}
        <span className={cn("inline-flex items-center justify-center", loading && "invisible")}>{children}</span>
        {loading && <span className="absolute inset-0 grid place-items-center"><Spinner /><span className="sr-only">{loadingLabel}</span></span>}
      </button>
      {announcement}
    </>
  );
});
Button.displayName = "Button";

export { Button, buttonVariants, Spinner };
