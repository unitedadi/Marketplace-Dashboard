import { MarketplaceBootstrap } from "@/components/MarketplaceBootstrap";
import { MARKETPLACE_API_BASE } from "@/lib/marketplace";

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

  return <MarketplaceBootstrap accountId={accountId} apiBase={MARKETPLACE_API_BASE} initialView={initialView} />;
}
