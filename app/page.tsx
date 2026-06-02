import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MarketplaceDashboard } from "@/components/MarketplaceDashboard";
import { loadDashboardData, resolveMarketplaceAccounts } from "@/lib/marketplace";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string | string[]; view?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawAccount = params.account_id;
  const accountId = Array.isArray(rawAccount) ? rawAccount[0] : rawAccount;
  const rawView = params.view;
  const initialView = Array.isArray(rawView) ? rawView[0] : rawView;

  // Dev / explicit selector: an account_id in the URL bypasses Clerk resolution.
  if (accountId) {
    const data = await loadDashboardData(accountId);
    return <MarketplaceDashboard initialData={data} initialView={initialView} />;
  }

  // Otherwise resolve the account from the signed-in Clerk user.
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  const accounts = email ? await resolveMarketplaceAccounts(email) : [];

  if (accounts.length === 0) {
    return <NoAccess email={email} />;
  }

  if (accounts.length > 1) {
    return <AccountChooser accounts={accounts} />;
  }

  const data = await loadDashboardData(accounts[0].account_id);
  return <MarketplaceDashboard initialData={data} initialView={initialView} />;
}

function AccountChooser({
  accounts,
}: {
  accounts: Array<{ account_id: string; display_name: string }>;
}) {
  return (
    <div className="auth-shell">
      <div className="chooser-card">
        <div className="eyebrow">Choose account</div>
        <h2>Select a workspace</h2>
        <p>Your email has access to more than one marketplace account.</p>
        <div className="chooser-list">
          {accounts.map((account) => (
            <a className="chooser-item" href={`/?account_id=${account.account_id}`} key={account.account_id}>
              <span className="chooser-item-name">{account.display_name}</span>
              <span className="chooser-item-id">{account.account_id}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoAccess({ email }: { email: string | null }) {
  return (
    <div className="auth-shell">
      <div className="chooser-card">
        <div className="eyebrow">No access</div>
        <h2>No marketplace account</h2>
        <p>
          {email ? `${email} isn't linked to a marketplace account yet.` : "Your account isn't linked to a marketplace yet."}{" "}
          Ask an account owner to invite you, then sign in again.
        </p>
      </div>
    </div>
  );
}
