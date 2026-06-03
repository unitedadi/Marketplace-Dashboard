"use client";

import { SignUp, useClerk, useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function AcceptInvitePanel() {
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn } = useUser();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const fallbackRedirectUrl = useMemo(() => {
    if (typeof window === "undefined") return "/";
    const accountId = new URLSearchParams(window.location.search).get("account_id");
    return accountId ? `/?account_id=${encodeURIComponent(accountId)}` : "/";
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || isSigningOut || typeof window === "undefined") return;
    setIsSigningOut(true);
    void signOut({ redirectUrl: window.location.href });
  }, [isLoaded, isSignedIn, isSigningOut, signOut]);

  if (!isLoaded || isSignedIn || isSigningOut) {
    return (
      <div className="bootstrap-spinner" aria-busy="true" aria-live="polite">
        <Loader2 className="spin" size={28} />
      </div>
    );
  }

  return <SignUp fallbackRedirectUrl={fallbackRedirectUrl} path="/accept-invite" routing="path" signInUrl="/sign-in" />;
}
