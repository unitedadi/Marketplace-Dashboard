import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="auth-shell">
      <SignUp fallbackRedirectUrl="/" path="/sign-up" routing="path" signInUrl="/sign-in" />
    </div>
  );
}
