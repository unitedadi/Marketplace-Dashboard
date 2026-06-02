import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="auth-shell">
      <SignUp afterSignUpUrl="/" path="/sign-up" routing="path" signInUrl="/sign-in" />
    </div>
  );
}
