import { ClerkProvider, SignUp } from "@clerk/nextjs";
import { MARKETPLACE_CLERK_PROVIDER_PROPS } from "@/lib/clerk";

export default function SignUpPage() {
  return (
    <ClerkProvider {...MARKETPLACE_CLERK_PROVIDER_PROPS}>
      <div className="auth-shell">
        <SignUp fallbackRedirectUrl="/" path="/sign-up" routing="path" signInUrl="/sign-in" />
      </div>
    </ClerkProvider>
  );
}
