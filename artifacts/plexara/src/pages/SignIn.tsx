import { SignIn } from "@clerk/react";
import { Activity } from "lucide-react";
import { Link } from "wouter";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="mb-8 flex flex-col items-center">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 mb-4">
          <Activity className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-2xl font-heading font-semibold text-foreground tracking-tight">Sign in to Plexara</h1>
      </div>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      {import.meta.env.DEV && (
        <Link href="/dev-login" className="mt-6 text-xs text-muted-foreground hover:text-primary underline underline-offset-4">
          Dev test login (bypass Clerk) →
        </Link>
      )}
    </div>
  );
}
