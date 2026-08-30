import Image from "next/image";

// The generated product imagery. Each shot is described for screen readers by what
// it SHOWS rather than what it is called, because "dashboard.png" tells a
// non-sighted reader nothing about the product.
export type ProductShot = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
};

export const heroShot: ProductShot = {
  src: "/product/hero-laptop.png",
  width: 1672,
  height: 941,
  alt: "A laptop showing a company website with the Garuda chat widget open. A visitor asks to schedule a demo, and three cards beside it show the outcome: an appointment booked, the lead captured with name and email, and the CRM updated.",
  caption: "One conversation becomes a booked appointment, a captured lead, and an updated CRM.",
};

export const productShots: ProductShot[] = [
  {
    src: "/product/dashboard.png",
    width: 1536,
    height: 1024,
    alt: "The Garuda overview screen showing totals for conversations, leads and messages, a conversation activity chart, recent conversations, and the list of agents with their status.",
    caption: "See what your agents are doing at a glance.",
  },
  {
    src: "/product/conversations.png",
    width: 1536,
    height: 1024,
    alt: "The conversations inbox: a list of visitor threads on the left, the selected transcript in the middle, and the captured contact details for that visitor on the right.",
    caption: "Every conversation, with the lead it produced attached.",
  },
  {
    src: "/product/widget-studio.png",
    width: 1536,
    height: 1024,
    alt: "The widget appearance screen, with fields for the widget name, welcome message and colour on the left, and a live preview of the resulting chat widget on the right.",
    caption: "Change how the widget looks and see it before you publish.",
  },
  {
    src: "/product/integrations.png",
    width: 1448,
    height: 1086,
    alt: "The integrations directory: a search field, category filters, and a grid of connectable apps, some already showing as connected.",
    caption: "Your customers connect their own accounts.",
  },
];

export const phoneShot: ProductShot = {
  src: "/product/phone-widget.png",
  width: 1122,
  height: 1402,
  alt: "A phone showing a business website with the Garuda chat widget open, where a visitor is asking about pricing and the assistant is replying.",
  caption: "It works the same on a phone.",
};

export function ProductFigure({ shot, priority = false, className }: { shot: ProductShot; priority?: boolean; className?: string }) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <Image
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          priority={priority}
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 90vw, 1100px"
          className="h-auto w-full"
        />
      </div>
      <figcaption className="mt-3 text-center text-xs text-slate-500">{shot.caption}</figcaption>
    </figure>
  );
}
