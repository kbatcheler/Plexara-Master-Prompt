import { Link } from "wouter";
import { Activity, Shield, Cpu, ArrowRight } from "lucide-react";

// In development we expose a static-credential dev-login page (App.tsx
// only registers the /dev-login route when import.meta.env.DEV is true).
// In production /dev-login does not exist, so the CTA must point at the
// real Clerk-backed sign-in route or wouter falls through to the SPA's
// 404 page. The two CTAs below shared the same hard-coded /dev-login
// link before, which is what produced the post-deploy 404.
const ENTER_PLATFORM_HREF = import.meta.env.DEV ? "/dev-login" : "/sign-in";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 flex flex-col">
      <header className="container mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2 group">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 group-hover:border-primary/50 transition-colors">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <span className="font-heading font-semibold text-xl tracking-tight">Plexara<span className="text-primary">.</span>health</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href={ENTER_PLATFORM_HREF} className="text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">
            Enter Platform
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20 relative overflow-hidden">
        {/* Abstract Background Elements */}
        <div className="absolute inset-0 z-0 flex items-center justify-center opacity-20 pointer-events-none">
          <div className="w-[800px] h-[800px] rounded-full border border-primary/20 absolute" />
          <div className="w-[600px] h-[600px] rounded-full border border-primary/30 absolute" />
          <div className="w-[400px] h-[400px] rounded-full border border-primary/40 absolute bg-primary/5 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-border text-xs font-medium text-primary mb-4">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Clinical Intelligence Platform
          </div>
          
          <h1 className="text-5xl md:text-7xl font-heading font-bold tracking-tight text-balance leading-tight">
            The Single Source of Truth for Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-cyan-300">Biochemistry</span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Plexara examines your health records through three independent AI analytical lenses. 
            Clinical precision meets computational clarity.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
            <Link href={ENTER_PLATFORM_HREF} className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-lg font-medium hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/20">
              Enter Platform
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto mt-32 text-left">
          <div className="p-6 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors">
            <Shield className="w-10 h-10 text-primary mb-4" />
            <h3 className="text-lg font-heading font-semibold mb-2">Clinical Synthesist</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Deep contextual analysis of biomarker relationships, identifying patterns invisible to standard reference ranges.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors">
            <Cpu className="w-10 h-10 text-primary mb-4" />
            <h3 className="text-lg font-heading font-semibold mb-2">Evidence Checker</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Cross-references findings against the latest peer-reviewed medical literature and clinical guidelines.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors">
            <Activity className="w-10 h-10 text-primary mb-4" />
            <h3 className="text-lg font-heading font-semibold mb-2">Contrarian Analyst</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Actively challenges the primary diagnosis, surfacing edge-case differentials and overlooked variables.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/40 py-8 text-center text-xs text-muted-foreground">
        <p>Plexara provides AI-generated health interpretations for informational purposes only. These are not medical diagnoses. Always consult a qualified healthcare professional before making health decisions based on these results.</p>
      </footer>
    </div>
  );
}
