import { AcceptInvitePanel } from "@/components/AcceptInvitePanel";
import { MARKETPLACE_CLERK_PROVIDER_PROPS } from "@/lib/clerk";
import { ClerkProvider } from "@clerk/nextjs";

// Clerk invitation links redirect here with __clerk_ticket; <SignUp> consumes
// the ticket and runs the accept-invite (set password) flow.
export default function AcceptInvitePage() {
  return (
    <ClerkProvider {...MARKETPLACE_CLERK_PROVIDER_PROPS}>
      <div className="auth-shell">
        <AcceptInvitePanel />
      </div>
    </ClerkProvider>
  );
}
