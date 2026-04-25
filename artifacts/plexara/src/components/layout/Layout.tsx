import { useUser, useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { useMode } from "../../context/ModeContext";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  LogOut, Activity, Settings as SettingsIcon, ChevronDown,
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

function NavItem({ group, currentPath }: { group: NavGroup; currentPath: string }) {
  const isActive = group.href
    ? currentPath === group.href || currentPath.startsWith(group.href + "/")
    : group.items?.some((i) => currentPath === i.href || currentPath.startsWith(i.href + "/"));

  const baseCls = `flex items-center gap-1.5 text-sm font-medium transition-colors px-2 py-1 rounded-md ${
    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
  }`;

  if (group.href) {
    return (
      <Link href={group.href} className={baseCls}>
        <group.icon className="w-3.5 h-3.5 opacity-70" />
        {group.label}
      </Link>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={`${baseCls} outline-none`}>
        <group.icon className="w-3.5 h-3.5 opacity-70" />
        {group.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {group.items?.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} className="flex flex-col items-start gap-0.5 cursor-pointer">
              <span className="text-sm font-medium">{item.label}</span>
              {item.hint && <span className="text-[11px] text-muted-foreground">{item.hint}</span>}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [location, setLocation] = useLocation();
  const { mode, toggleMode } = useMode();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/30">
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 group" data-testid="nav-logo">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 group-hover:border-primary/50 transition-colors">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <span className="font-heading font-semibold text-lg tracking-tight">Plexara<span className="text-primary">.</span></span>
            </Link>

            <nav className="hidden md:flex items-center gap-1 ml-4">
              {NAV.map((g) => <NavItem key={g.label} group={g} currentPath={location} />)}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <PatientSwitcher />

            <div className="hidden lg:flex items-center space-x-2 bg-secondary/50 px-3 py-1.5 rounded-full border border-border/50">
              <Label htmlFor="mode-toggle" className={`text-xs cursor-pointer ${mode === "patient" ? "text-primary font-medium" : "text-muted-foreground"}`}>Patient</Label>
              <Switch
                id="mode-toggle"
                checked={mode === "clinician"}
                onCheckedChange={toggleMode}
                className="data-[state=checked]:bg-primary"
              />
              <Label htmlFor="mode-toggle" className={`text-xs cursor-pointer ${mode === "clinician" ? "text-primary font-medium" : "text-muted-foreground"}`}>Clinician</Label>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full bg-secondary/60 hover:bg-secondary px-1 py-1 pr-3 transition-colors outline-none" data-testid="user-menu">
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[11px] font-medium text-primary">
                  {(user?.firstName?.[0] ?? user?.primaryEmailAddress?.emailAddress?.[0] ?? "U").toUpperCase()}
                </div>
                <span className="hidden sm:inline text-xs text-muted-foreground max-w-[120px] truncate">
                  {user?.fullName || user?.primaryEmailAddress?.emailAddress || "Test user"}
                </span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Account</DropdownMenuLabel>
                <DropdownMenuItem asChild><Link href="/settings" className="flex items-center gap-2"><SettingsIcon className="w-3.5 h-3.5" /> Settings</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/consents">Consent &amp; data control</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/audit">Audit log</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/admin">Admin console</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => signOut(() => setLocation("/"))}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-border/40 bg-background py-6">
        <div className="container mx-auto px-4">
          <p className="text-xs text-muted-foreground text-center max-w-3xl mx-auto leading-relaxed">
            <strong className="text-foreground">DISCLAIMER:</strong> Plexara provides AI-generated health interpretations for informational purposes only. These are not medical diagnoses. Always consult a qualified healthcare professional before making health decisions based on these results.
          </p>
        </div>
      </footer>
    </div>
  );
}
