import { useEffect } from "react";
import { useLocation } from "wouter";
import { HelpLayout, type HelpTocEntry } from "@/components/help/HelpLayout";
import { Overview } from "./help/Overview";
import { FunctionalMedicinePrimer } from "./help/FunctionalMedicinePrimer";
import { GaugesAndColors } from "./help/GaugesAndColors";
import { HealthDomainsGuide, HEALTH_DOMAIN_TOC } from "./help/HealthDomainsGuide";
import { FeatureGuide } from "./help/FeatureGuide";
import { PrivacyData } from "./help/PrivacyData";
import { WhenToCallDoctor } from "./help/WhenToCallDoctor";
import { Faq } from "./help/Faq";
import { Contact } from "./help/Contact";

/**
 * Help — Plexara's full functional guide and help reference.
 *
 * This page is structured as a long-form, sectioned guide so that:
 *   1. Inline HelpHints elsewhere in the app can deep-link to specific
 *      sections via /help#<section-id>.
 *   2. Patients reading top-to-bottom get a coherent introduction to both
 *      the product and the functional-medicine model it's built on.
 *   3. Clinicians can jump straight to feature deep-dives via the sticky
 *      sidebar TOC.
 *
 * The TOC entries here ARE the help URL contract — section ids must
 * remain stable. If you add a new section, append (don't reorder) and
 * include it in TOC.
 */

const TOC: HelpTocEntry[] = [
  { id: "overview", label: "What Plexara is" },
  { id: "functional-medicine", label: "Functional medicine 101" },
  { id: "gauges-colors", label: "Gauges & colours" },
  {
    id: "health-domains",
    label: "The 8 health domains",
    children: HEALTH_DOMAIN_TOC,
  },
  {
    id: "feature-guide",
    label: "Every feature, explained",
    children: [
      { id: "feature-records-data", label: "Records & data" },
      { id: "feature-insights", label: "Insights & reports" },
      { id: "feature-care-plan", label: "Care plan & actions" },
      { id: "feature-sharing-audit", label: "Sharing & audit" },
      { id: "feature-account", label: "Account" },
    ],
  },
  { id: "privacy-data", label: "Privacy & data protection" },
  { id: "when-to-call", label: "When to call your doctor" },
  { id: "faq", label: "FAQ" },
  { id: "contact", label: "Contact" },
];

export default function Help() {
  const [location] = useLocation();

  // Wouter strips the hash from `location`, so we read it directly off
  // window.location and scroll to the matching section. This is what
  // lets external HelpHint deep links (e.g. /help#stack-intelligence)
  // land on the right anchor on first load.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    // Defer one frame so the section <div id> is mounted.
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [location]);

  return (
    <div className="space-y-8" data-testid="help-page">
      <header className="max-w-3xl">
        <p className="text-[11px] uppercase tracking-wider font-medium text-primary mb-2">
          Plexara guide
        </p>
        <h1 className="text-3xl font-heading font-bold tracking-tight">
          Help &amp; functional guide
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          A complete reference for Plexara: what the system is, the
          functional-medicine model behind it, what every gauge and colour
          means, a deep-dive into the eight health domains, and a tour of
          every feature with deep links straight to the page in your app.
          Plexara is a <strong>wellness intelligence tool</strong>, not a
          medical device — when something feels urgent, talk to your
          physician.
        </p>
      </header>

      <HelpLayout toc={TOC}>
        <Overview />
        <FunctionalMedicinePrimer />
        <GaugesAndColors />
        <HealthDomainsGuide />
        <FeatureGuide />
        <PrivacyData />
        <WhenToCallDoctor />
        <Faq />
        <Contact />
      </HelpLayout>
    </div>
  );
}
