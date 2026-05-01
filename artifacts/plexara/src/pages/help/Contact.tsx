import { Mail, Lock, Eye, PhoneCall } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { HelpSection } from "@/components/help/HelpSection";

export function Contact() {
  return (
    <HelpSection id="contact" title="Contact" Icon={Mail}>
      <div className="grid sm:grid-cols-2 gap-4">
        <ContactCard
          Icon={Mail}
          label="General questions"
          value="hello@plexara.health"
          href="mailto:hello@plexara.health"
        />
        <ContactCard
          Icon={Lock}
          label="Privacy & data requests"
          value="privacy@plexara.health"
          href="mailto:privacy@plexara.health"
        />
        <ContactCard
          Icon={Eye}
          label="Security disclosures"
          value="security@plexara.health"
          href="mailto:security@plexara.health"
        />
        <ContactCard
          Icon={PhoneCall}
          label="Medical emergency"
          value="Call your local emergency number"
          href={undefined}
        />
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Plexara responds to non-urgent inquiries within two business days.
        See our{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>
        ,{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        , and{" "}
        <Link href="/disclaimer" className="underline">
          Medical Disclaimer
        </Link>
        .
      </p>
    </HelpSection>
  );
}

function ContactCard({
  Icon,
  label,
  value,
  href,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href: string | undefined;
}) {
  const inner = (
    <Card className="h-full hover:border-primary/40 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          <CardDescription className="text-xs uppercase tracking-wider">
            {label}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="text-sm font-medium">{value}</CardContent>
    </Card>
  );
  return href ? (
    <a href={href} className="block no-underline">
      {inner}
    </a>
  ) : (
    inner
  );
}
