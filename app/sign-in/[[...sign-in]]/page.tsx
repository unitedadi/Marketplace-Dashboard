import { ClerkProvider, SignIn } from "@clerk/nextjs";
import { MARKETPLACE_CLERK_PROVIDER_PROPS } from "@/lib/clerk";

export default function SignInPage() {
  return (
    <ClerkProvider {...MARKETPLACE_CLERK_PROVIDER_PROPS}>
      <div className="auth-shell">
        <SignIn fallbackRedirectUrl="/" path="/sign-in" routing="path" signUpUrl="/sign-up" />
      </div>
    </ClerkProvider>
  );
}
