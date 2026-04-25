import { useState } from "react";
import { useUser, useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { useMode } from "../../context/ModeContext";
import { devSignOut } from "../../lib/dev-auth";
import { cn } from "@/lib/utils";
import {
  LogOut, Settings as SettingsIcon, ChevronDown, Menu, X,
  LayoutDashboard, FileText, Sparkles, HeartPulse, MessageSquare,
} from "lucide-react";
import { PatientSwitcher } from "./PatientSwitcher";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface NavGroup {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  items?: { label: string; href: string; hint?: string }[];
}

const NAV: NavGroup[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    label: "My data", icon: FileText, items: [
      { label: "Records",   href: "/records",   hint: "Lab reports & uploads" },
      { label: "Timeline",  href: "/timeline",  hint: "Chronological history" },
      { label: "Wearables", href: "/wearables", hint: "Apple Health, Oura, Fitbit" },
      { label: "Genetics",  href: "/genetics",  hint: "Raw SNP data & PRS" },
      { label: "Imaging",   href: "/imaging",   hint: "DICOM viewer" },
    ],
  },
  {
    label: "Insights", icon: Sparkles, items: [
      { label: "Biological age", href: "/biological-age", hint: "Phenotypic & epigenetic" },
      { label: "Trends",         href: "/trends",         hint: "Regression & change alerts" },
      { label: "Safety",         href: "/safety",         hint: "Interactions & AI disagreements" },
    ],
  },
  {
    label: "Care plan", icon: HeartPulse, items: [
      { label: "Supplements", href: "/supplements", hint: "Stack management" },
      { label: "Protocols",   href: "/protocols",   hint: "Evidence-based programs" },
      { label: "Share with clinician", href: "/share-portal", hint: "Generate share link" },
    ],
  },
  { label: "Ask", href: "/chat", icon: MessageSquare },
];

function isGroupActive(group: NavGroup, currentPath: string): boolean {
  if (group.href) return currentPath === group.href || currentPath.startsWith(group.href + "/");
  return !!group.items?.some((i) => currentPath === i.href || currentPath.startsWith(i.href + "/"));
}

function NavItem({ group, currentPath }: { group: NavGroup; currentPath: string }) {
  const isActive = isGroupActive(group, currentPath);

  const baseCls = cn(
    "inline-flex items-center gap-1.5 px-3 h-10 rounded-lg text-sm font-medium transition-colors",
    "outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    isActive
      ? "text-foreground bg-secondary"
      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
  );

  if (group.href) {
    return (
      <Link href={group.href} className={baseCls} data-testid={`nav-${group.label.toLowerCase()}`}>
        {group.label}
      </Link>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(baseCls, "data-[state=open]:bg-secondary data-[state=open]:text-foreground")}>
        {group.label}
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-1.5">
        {group.items?.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} className="flex flex-col items-start gap-0.5 cursor-pointer rounded-md px-2.5 py-2">
              <span className="text-sm font-medium">{item.label}</span>
              {item.hint && <span className="text-[11px] text-muted-foreground">{item.hint}</span>}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Segmented control: replaces the previous mode toggle Switch.
   Segmented controls let the user see both options at a glance, which
   matches the brief better than a binary switch.                       */
function ModeSegment() {
  const { mode, toggleMode } = useMode();
  const setPatient = () => { if (mode !== "patient") toggleMode(); };
  const setClinician = () => { if (mode !== "clinician") toggleMode(); };

  return (
    <div
      role="radiogroup"
      aria-label="Display mode"
      className="inline-flex items-center rounded-lg bg-secondary p-0.5 text-xs font-medium"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "patient"}
        onClick={setPatient}
        data-testid="mode-patient"
        className={cn(
          "px-3 h-8 rounded-md transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          mode === "patient"
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Patient
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "clinician"}
        onClick={setClinician}
        data-testid="mode-clinician"
        className={cn(
          "px-3 h-8 rounded-md transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          mode === "clinician"
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Clinician
      </button>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    // devSignOut() is idempotent; clerk signOut may fail if not signed in.
    await devSignOut();
    try { await signOut(); } catch { /* clerk may not be active */ }
    setLocation("/");
  };

  const userInitial = (
    user?.firstName?.[0] ?? user?.primaryEmailAddress?.emailAddress?.[0] ?? "U"
  ).toUpperCase();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/20">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-6 md:px-8 lg:px-12">
          {/* ── Left: logo + patient switcher (the most critical context indicator) ── */}
          <Link
            href="/dashboard"
            className="font-heading text-lg font-bold tracking-tight text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md"
            data-testid="nav-logo"
          >
            Plexara
          </Link>

          {/* Patient switcher stays visible on every breakpoint per brief §3 —
              it is the most critical context indicator. */}
          <PatientSwitcher />

          {/* ── Centre: primary nav (desktop only) ── */}
          <nav className="hidden md:flex flex-1 items-center justify-center gap-1">
            {NAV.map((g) => <NavItem key={g.label} group={g} currentPath={location} />)}
          </nav>

          {/* Spacer keeps right cluster pinned right when nav is hidden on mobile */}
          <div className="md:hidden flex-1" />

          {/* ── Right: mode toggle + user menu ── */}
          <div className="flex items-center gap-3">
            {/* Mode toggle also stays visible on mobile per brief §3. */}
            <ModeSegment />

            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center gap-2 rounded-full border border-border bg-card hover:bg-secondary/60 pl-1 pr-3 py-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                data-testid="user-menu"
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  {userInitial}
                </div>
                <span className="hidden md:inline text-xs text-muted-foreground max-w-[120px] truncate">
                  {user?.fullName || user?.primaryEmailAddress?.emailAddress || "Test user"}
                </span>
                <ChevronDown className="hidden md:inline w-3 h-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Account</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
                    <SettingsIcon className="w-3.5 h-3.5" /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/consents" className="cursor-pointer">Consent &amp; data control</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/audit" className="cursor-pointer">Audit log</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/admin" className="cursor-pointer">Admin console</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive cursor-pointer"
                  data-testid="signout-button"
                >
                  <LogOut className="w-3.5 h-3.5 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* ── Mobile hamburger ── */}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card hover:bg-secondary/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              data-testid="mobile-menu-toggle"
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* ── Mobile drawer ── */}
        {mobileOpen && (
          <div
            id="mobile-nav"
            className="md:hidden border-t border-border bg-card px-6 py-4 space-y-3"
          >
            <nav className="flex flex-col gap-1">
              {NAV.map((g) => {
                const active = isGroupActive(g, location);
                if (g.href) {
                  return (
                    <Link
                      key={g.label}
                      href={g.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2 px-3 h-11 rounded-lg text-sm font-medium transition-colors",
                        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60",
                      )}
                    >
                      <g.icon className="w-4 h-4 opacity-70" />
                      {g.label}
                    </Link>
                  );
                }
                return (
                  <div key={g.label} className="space-y-1">
                    <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      {g.label}
                    </div>
                    {g.items?.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className="flex flex-col px-3 py-2 rounded-lg text-sm text-foreground hover:bg-secondary/60 transition-colors"
                      >
                        <span className="font-medium">{item.label}</span>
                        {item.hint && <span className="text-[11px] text-muted-foreground">{item.hint}</span>}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 mx-auto w-full max-w-[1280px] px-6 md:px-8 lg:px-12 py-8 md:py-10">
        {children}
      </main>

      {/* Slim, muted disclaimer footer — present but not anxiety-inducing. */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-[1280px] px-6 md:px-8 lg:px-12 py-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Plexara provides AI-generated health interpretations for informational purposes only. These are not medical diagnoses — always consult a qualified healthcare professional before making health decisions.
          </p>
        </div>
      </footer>
    </div>
  );
}
