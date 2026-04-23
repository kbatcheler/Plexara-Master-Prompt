import { useEffect, useRef } from "react";
import { ClerkProvider, Show, useClerk } from "@clerk/react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModeProvider } from "./context/ModeContext";

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
import NotFound from "./pages/not-found";
import Settings from "./pages/Settings";
import Audit from "./pages/Audit";
import Share from "./pages/Share";
import SharedView from "./pages/SharedView";
import Protocols from "./pages/Protocols";
import Report from "./pages/Report";
import Chat from "./pages/Chat";
import Genetics from "./pages/Genetics";
import Imaging from "./pages/Imaging";
import ImagingViewer from "./pages/ImagingViewer";
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

function HomeRedirect() {
  if (isDevSignedIn()) return <Redirect to="/dashboard" />;
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

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  if (isDevSignedIn()) {
    return (
      <OnboardingGate>
        <Layout>
          <Component />
        </Layout>
      </OnboardingGate>
    );
  }
  return (
    <>
      <Show when="signed-in">
        <OnboardingGate>
          <Layout>
            <Component />
          </Layout>
        </OnboardingGate>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
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
        <ClerkQueryClientCacheInvalidator />
        <ModeProvider>
          <ActivePatientProvider>
            <TooltipProvider>
              <Switch>
                <Route path="/" component={HomeRedirect} />
                <Route path="/share/:token" component={SharedView} />
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/sign-up/*?" component={SignUpPage} />
                <Route path="/dev-login" component={DevSignIn} />
                <Route path="/onboarding">
                  <>
                    <Show when="signed-in">
                      <Onboarding />
                    </Show>
                    <Show when="signed-out">
                      <Redirect to="/sign-in" />
                    </Show>
                  </>
                </Route>
                <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
                <Route path="/records"><ProtectedRoute component={Records} /></Route>
                <Route path="/timeline"><ProtectedRoute component={Timeline} /></Route>
                <Route path="/biological-age"><ProtectedRoute component={BiologicalAge} /></Route>
                <Route path="/supplements"><ProtectedRoute component={Supplements} /></Route>
                <Route path="/protocols"><ProtectedRoute component={Protocols} /></Route>
                <Route path="/chat"><ProtectedRoute component={Chat} /></Route>
                <Route path="/share-portal"><ProtectedRoute component={Share} /></Route>
                <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
                <Route path="/audit"><ProtectedRoute component={Audit} /></Route>
                <Route path="/reports/:id"><ProtectedRoute component={Report} /></Route>
                <Route path="/genetics"><ProtectedRoute component={Genetics} /></Route>
                <Route path="/imaging"><ProtectedRoute component={Imaging} /></Route>
                <Route path="/imaging/:id"><ProtectedRoute component={ImagingViewer} /></Route>
                <Route path="/consents"><ProtectedRoute component={Consents} /></Route>
                <Route path="/admin"><ProtectedRoute component={Admin} /></Route>
                <Route path="/wearables"><ProtectedRoute component={Wearables} /></Route>
                <Route path="/trends"><ProtectedRoute component={Trends} /></Route>
                <Route path="/safety"><ProtectedRoute component={Safety} /></Route>
                <Route component={NotFound} />
              </Switch>
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
