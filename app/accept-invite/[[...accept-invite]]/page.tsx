import { AcceptInvitePanel } from "@/components/AcceptInvitePanel";

// Clerk invitation links redirect here with __clerk_ticket; <SignUp> consumes
// the ticket and runs the accept-invite (set password) flow.
export default function AcceptInvitePage() {
  return (
    <div className="auth-shell">
      <AcceptInvitePanel />
    </div>
  );
}
