import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="auth-shell">
      <SignIn fallbackRedirectUrl="/" path="/sign-in" routing="path" signUpUrl="/sign-up" />
    </div>
  );
}
