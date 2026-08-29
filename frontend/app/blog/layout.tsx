import { BlogFooter, BlogNav } from "@/components/blog/blog-chrome";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <BlogNav />
      <div className="flex-1">{children}</div>
      <BlogFooter />
    </div>
  );
}
