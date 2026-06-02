import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="auth-shell">
      <SignIn afterSignInUrl="/" path="/sign-in" routing="path" signUpUrl="/sign-up" />
    </div>
  );
}
