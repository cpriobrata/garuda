import { PortalShell } from "@/components/portal/portal-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
