import { ClerkProvider, SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <div className="auth-shell">
        <SignIn fallbackRedirectUrl="/" path="/sign-in" routing="path" signUpUrl="/sign-up" />
      </div>
    </ClerkProvider>
  );
}
