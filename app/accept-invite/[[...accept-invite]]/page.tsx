import { SignUp } from "@clerk/nextjs";

// Clerk invitation links redirect here with __clerk_ticket; <SignUp> consumes
// the ticket and runs the accept-invite (set password) flow.
export default function AcceptInvitePage() {
  return (
    <div className="auth-shell">
      <SignUp fallbackRedirectUrl="/" path="/accept-invite" routing="path" signInUrl="/sign-in" />
    </div>
  );
}
