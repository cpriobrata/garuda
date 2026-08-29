import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Article } from "@/content/blog/types";
import { formatDate, readingMinutes } from "@/content/blog/utils";

export function ArticleCard({ article, featured = false }: { article: Article; featured?: boolean }) {
  const minutes = readingMinutes(article);

  return (
    <Card
      className={cn(
        "border-slate-200/80 bg-white shadow-none transition duration-300 hover:border-indigo-200 hover:shadow-soft motion-reduce:transition-none",
        featured && "sm:col-span-2",
      )}
    >
      <CardContent className={featured ? "p-7 sm:p-9" : "p-6 sm:p-7"}>
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="purple">{article.topic}</Badge>
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
            {minutes} min read
          </span>
        </div>

        <h3
          className={cn(
            "mt-4 font-bold tracking-[-.03em] text-slate-950",
            featured ? "text-balance text-2xl sm:text-[32px] sm:leading-[1.15]" : "text-xl",
          )}
        >
          <Link
            href={`/blog/${article.slug}`}
            className="transition-colors hover:text-indigo-700 motion-reduce:transition-none"
          >
            {article.title}
          </Link>
        </h3>

        <p
          className={cn(
            "mt-3 text-slate-600",
            featured ? "max-w-2xl text-[17px] leading-7" : "text-sm leading-6",
          )}
        >
          {article.excerpt}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <span>
            Updated{" "}
            <time dateTime={article.dateModified}>{formatDate(article.dateModified)}</time>
          </span>
          <Link
            href={`/blog/${article.slug}`}
            className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Read the guide
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only">: {article.title}</span>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
