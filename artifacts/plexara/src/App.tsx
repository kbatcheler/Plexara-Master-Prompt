import { useEffect, useRef } from "react";
import { ClerkProvider, RedirectToSignIn, Show, useClerk } from "@clerk/react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModeProvider } from "./context/ModeContext";
import { ThemeMount } from "./hooks/useTheme";

// Pages
import Landing from "./pages/Landing";
import SignInPage from "./pages/SignIn";
import SignUpPage from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import Records from "./pages/Records";
import Timeline from "./pages/Timeline";
import BiologicalAge from "./pages/BiologicalAge";
import Supplements from "./pages/Supplements";
import Onboarding from "./pages/Onboarding";
import HealthProfile from "./pages/HealthProfile";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Disclaimer from "./pages/Disclaimer";
import { ConsentGate } from "./components/ConsentGate";
import NotFound from "./pages/not-found";
import Settings from "./pages/Settings";
import Help from "./pages/Help";
import Sharing from "./pages/Sharing";
import AcceptInvite from "./pages/AcceptInvite";
import Audit from "./pages/Audit";
import Share from "./pages/Share";
import SharedView from "./pages/SharedView";
import Protocols from "./pages/Protocols";
import Report from "./pages/Report";
import Chat from "./pages/Chat";
import Genetics from "./pages/Genetics";
import Imaging from "./pages/Imaging";
import ImagingViewer from "./pages/ImagingViewer";
import ImagingCompare from "./pages/ImagingCompare";
import Consents from "./pages/Consents";
import Admin from "./pages/Admin";
import Wearables from "./pages/Wearables";
import Trends from "./pages/Trends";
import Safety from "./pages/Safety";
import DevSignIn from "./pages/DevSignIn";
import { isDevSignedIn } from "./lib/dev-auth";
import { Layout } from "./components/layout/Layout";
import { useCurrentPatient } from "./hooks/use-current-patient";
import { ActivePatientProvider } from "./context/ActivePatientContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

// Dev-only static-login bypass should never ship to production. Gating on
// import.meta.env.DEV (Vite) ensures the dead-code-eliminated production
// bundle has no `/dev-login` reference at all.
const DEV_BYPASS_ENABLED = import.meta.env.DEV;

function HomeRedirect() {
  if (DEV_BYPASS_ENABLED && isDevSignedIn()) return <Redirect to="/dashboard" />;
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function SignedOutRedirect() {
  // In dev with the bypass enabled, fall back to the local dev-login page.
  // In prod, send the user through Clerk's hosted sign-in (which may itself
  // be a routed page within the SPA — Clerk handles that).
  if (DEV_BYPASS_ENABLED) return <Redirect to="/dev-login" />;
  return <RedirectToSignIn />;
}

// Wraps OnboardingGate (creates a patient if missing) with ConsentGate
// (blocks until the user accepts the current legal/medical bundle). Order
// matters: we need a patient row to record consent against, so onboarding
// runs first, then the consent gate, then the actual page.
function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  if (DEV_BYPASS_ENABLED && isDevSignedIn()) {
    return (
      <OnboardingGate>
        <ConsentGate>
          <Layout>
            <Component />
          </Layout>
        </ConsentGate>
      </OnboardingGate>
    );
  }
  return (
    <>
      <Show when="signed-in">
        <OnboardingGate>
          <ConsentGate>
            <Layout>
              <Component />
            </Layout>
          </ConsentGate>
        </OnboardingGate>
      </Show>
      <Show when="signed-out">
        <SignedOutRedirect />
      </Show>
    </>
  );
}

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { needsOnboarding, isLoading } = useCurrentPatient();
  
  if (isLoading) return null;
  if (needsOnboarding) return <Redirect to="/onboarding" />;
  return <>{children}</>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ThemeMount />
        <ClerkQueryClientCacheInvalidator />
        <ModeProvider>
          <ActivePatientProvider>
            <TooltipProvider>
              <ErrorBoundary>
              <Switch>
                <Route path="/" component={HomeRedirect} />
                <Route path="/share/:token" component={SharedView} />
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/sign-up/*?" component={SignUpPage} />
                {/* Legal pages are deliberately outside ProtectedRoute so the
                    user can read them from inside ConsentGate (target="_blank"),
                    from the sign-in / sign-up screens, and from the public
                    share view. They render without the app chrome. */}
                <Route path="/terms" component={Terms} />
                <Route path="/privacy" component={Privacy} />
                <Route path="/disclaimer" component={Disclaimer} />
                {DEV_BYPASS_ENABLED && (
                  <Route path="/dev-login" component={DevSignIn} />
                )}
                <Route path="/onboarding">
                  {DEV_BYPASS_ENABLED && isDevSignedIn() ? <Onboarding /> : (
                    <>
                      <Show when="signed-in"><Onboarding /></Show>
                      <Show when="signed-out"><SignedOutRedirect /></Show>
                    </>
                  )}
                </Route>
                <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
                <Route path="/records"><ProtectedRoute component={Records} /></Route>
                <Route path="/timeline"><ProtectedRoute component={Timeline} /></Route>
                <Route path="/biological-age"><ProtectedRoute component={BiologicalAge} /></Route>
                <Route path="/supplements"><ProtectedRoute component={Supplements} /></Route>
                <Route path="/protocols"><ProtectedRoute component={Protocols} /></Route>
                <Route path="/chat"><ProtectedRoute component={Chat} /></Route>
                <Route path="/share-portal"><ProtectedRoute component={Share} /></Route>
                <Route path="/profile"><ProtectedRoute component={HealthProfile} /></Route>
                <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
                <Route path="/help"><ProtectedRoute component={Help} /></Route>
                <Route path="/sharing"><ProtectedRoute component={Sharing} /></Route>
                <Route path="/invitations/:token" component={AcceptInvite} />
                <Route path="/audit"><ProtectedRoute component={Audit} /></Route>
                <Route path="/report"><ProtectedRoute component={Report} /></Route>
                <Route path="/reports/:id"><ProtectedRoute component={Report} /></Route>
                <Route path="/genetics"><ProtectedRoute component={Genetics} /></Route>
                <Route path="/imaging"><ProtectedRoute component={Imaging} /></Route>
                <Route path="/imaging/compare"><ProtectedRoute component={ImagingCompare} /></Route>
                <Route path="/imaging/:id"><ProtectedRoute component={ImagingViewer} /></Route>
                <Route path="/consents"><ProtectedRoute component={Consents} /></Route>
                <Route path="/admin"><ProtectedRoute component={Admin} /></Route>
                <Route path="/wearables"><ProtectedRoute component={Wearables} /></Route>
                <Route path="/trends"><ProtectedRoute component={Trends} /></Route>
                <Route path="/safety"><ProtectedRoute component={Safety} /></Route>
                <Route component={NotFound} />
              </Switch>
              </ErrorBoundary>
              <Toaster />
            </TooltipProvider>
          </ActivePatientProvider>
        </ModeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
