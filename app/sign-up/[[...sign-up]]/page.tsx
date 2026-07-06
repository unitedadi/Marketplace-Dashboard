import { ClerkProvider, SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <div className="auth-shell">
        <SignUp fallbackRedirectUrl="/" path="/sign-up" routing="path" signInUrl="/sign-in" />
      </div>
    </ClerkProvider>
  );
}
