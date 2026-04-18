import { useUser, useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { useMode } from "../../context/ModeContext";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LogOut, Activity, Settings as SettingsIcon, MoreHorizontal } from "lucide-react";
import { PatientSwitcher } from "./PatientSwitcher";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const { mode, toggleMode } = useMode();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary/30">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 group-hover:border-primary/50 transition-colors">
                <Activity className="w-4 h-4 text-primary" />
              </div>
              <span className="font-heading font-semibold text-lg tracking-tight">Plexara<span className="text-primary">.</span></span>
            </Link>
            
            <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-muted-foreground ml-6">
              <Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
              <Link href="/records" className="hover:text-primary transition-colors">Records</Link>
              <Link href="/timeline" className="hover:text-primary transition-colors">Timeline</Link>
              <Link href="/biological-age" className="hover:text-primary transition-colors">Bio Age</Link>
              <Link href="/supplements" className="hover:text-primary transition-colors">Supplements</Link>
              <Link href="/genetics" className="hover:text-primary transition-colors">Genetics</Link>
              <Link href="/imaging" className="hover:text-primary transition-colors">Imaging</Link>
              <Link href="/wearables" className="hover:text-primary transition-colors">Wearables</Link>
              <Link href="/trends" className="hover:text-primary transition-colors">Trends</Link>
              <Link href="/chat" className="hover:text-primary transition-colors">Ask</Link>
              <DropdownMenu>
                <DropdownMenuTrigger className="hover:text-primary transition-colors flex items-center gap-1">
                  More <MoreHorizontal className="w-3 h-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem asChild><Link href="/protocols">Protocols</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/share-portal">Share with clinician</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/consents">Consent &amp; data control</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/audit">Audit log</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/admin">Admin console</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <PatientSwitcher />
            <Link href="/settings" className="text-muted-foreground hover:text-primary" title="Settings">
              <SettingsIcon className="w-4 h-4" />
            </Link>
            {/* Mode Toggle */}
            <div className="flex items-center space-x-2 bg-secondary/50 px-3 py-1.5 rounded-full border border-border/50">
              <Label htmlFor="mode-toggle" className={`text-xs cursor-pointer ${mode === "patient" ? "text-primary font-medium" : "text-muted-foreground"}`}>Patient</Label>
              <Switch
                id="mode-toggle"
                checked={mode === "clinician"}
                onCheckedChange={toggleMode}
                className="data-[state=checked]:bg-primary"
              />
              <Label htmlFor="mode-toggle" className={`text-xs cursor-pointer ${mode === "clinician" ? "text-primary font-medium" : "text-muted-foreground"}`}>Clinician</Label>
            </div>

            {/* User Profile */}
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-medium leading-none">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</span>
                <span className="text-xs text-muted-foreground mt-1">ID: {user?.id.substring(0, 8)}</span>
              </div>
              <button 
                onClick={() => signOut(() => setLocation("/"))}
                className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80 hover:text-destructive transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>

      {/* Disclaimer Footer */}
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
