"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import OnboardingSteps from "@/components/OnboardingSteps";
import EbayConnectCard from "@/components/EbayConnectCard";
import { fetchCurrentUser } from "@/lib/client/auth";

export default function ConnectEbayPage() {
  const router = useRouter();
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user) {
        router.replace("/signup");
        return;
      }
      setUserName(user.name.split(" ")[0]);
    });
  }, [router]);

  return (
    <div className="hero-mesh grain relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="relative mb-8">
        <Logo />
      </div>

      <OnboardingSteps current={1} />

      {/* useSearchParams inside the card needs a Suspense boundary to build. */}
      <Suspense fallback={null}>
        <EbayConnectCard
          firstName={userName}
          doneLabel="Back to the app"
          onDone={() => router.push("/app")}
        />
      </Suspense>
    </div>
  );
}
