"use client";

import { useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MarketplaceDashboard } from "@/components/MarketplaceDashboard";
import {
  BookingsResponse,
  DashboardData,
  emptyDashboardData,
  MarketplaceAccount,
} from "@/lib/marketplace";

type BootstrapProps = {
  accountId?: string;
  initialView?: string;
};

function withAccount(path: string, accountId: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}account_id=${encodeURIComponent(accountId)}`;
}

async function proxyJson<T>(path: string, accountId?: string): Promise<T> {
  const target = accountId ? withAccount(path, accountId) : path;
  const response = await fetch(`/api/marketplace/${target}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function resolveAccounts(email: string): Promise<MarketplaceAccount[]> {
  const encoded = encodeURIComponent(email);
  const data = await proxyJson<{ items?: MarketplaceAccount[] }>(`auth/accounts?email=${encoded}`);
  return data.items ?? [];
}

async function loadDashboard(accountId: string): Promise<DashboardData> {
  const context = await proxyJson<DashboardData["context"]>("context", accountId);
  const caps = context.capabilities ?? {};
  const emptyBookings: BookingsResponse = { account: context.account, items: [], total: 0, limit: 100 };

  const [bookingsNew, bookingsCompleted, ledger, nurses, availability] = await Promise.all([
    proxyJson<BookingsResponse>("bookings?limit=100&view=new", accountId).catch(() => emptyBookings),
    proxyJson<BookingsResponse>("bookings?limit=100&view=completed", accountId).catch(() => emptyBookings),
    proxyJson<DashboardData["ledger"]>("ledger?limit=100", accountId).catch(() => ({
      account: context.account,
      totals: {},
      total_amount_fils: 0,
      items: [],
      limit: 100,
    })),
    caps.nurses
      ? proxyJson<DashboardData["nurses"]>("nurses", accountId).catch(() => ({
          account: context.account,
          items: [],
        }))
      : Promise.resolve({ account: context.account, items: [] }),
    caps.availability
      ? proxyJson<DashboardData["availability"]>("availability", accountId).catch(() => ({
          account: context.account,
          items: [],
        }))
      : Promise.resolve({ account: context.account, items: [] }),
  ]);

  return {
    apiBase: "proxy",
    error: null,
    context,
    bookings: {
      account: bookingsNew.account,
      new: bookingsNew.items,
      completed: bookingsCompleted.items,
    },
    ledger,
    nurses,
    availability,
  };
}

export function MarketplaceBootstrap({ accountId, initialView }: BootstrapProps) {
  const { isLoaded, isSignedIn, user } = useUser();
  const [selectedAccountId, setSelectedAccountId] = useState(accountId ?? null);
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([]);
  const [accountsResolved, setAccountsResolved] = useState(Boolean(accountId));
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const email = useMemo(() => user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null, [user]);

  useEffect(() => {
    if (accountId) {
      setSelectedAccountId(accountId);
      setAccountsResolved(true);
      return;
    }
    if (!isLoaded || !isSignedIn || !email) return;

    let cancelled = false;
    setAccountsResolved(false);
    setError(null);
    resolveAccounts(email)
      .then((items) => {
        if (cancelled) return;
        setAccounts(items);
        setAccountsResolved(true);
        if (items.length === 1) setSelectedAccountId(items[0].account_id);
      })
      .catch((err) => {
        if (!cancelled) {
          setAccountsResolved(true);
          setError(err instanceof Error ? err.message : "Could not resolve marketplace account.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, email, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    setError(null);
    setData(null);
    loadDashboard(selectedAccountId)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load marketplace dashboard.";
        setData(emptyDashboardData(message, selectedAccountId));
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  if (!isLoaded) return <SpinnerOnly />;

  if (!isSignedIn && !accountId) {
    return (
      <StatusCard
        title="Sign in"
        body="Sign in with your marketplace email, or open a debug URL with an account_id."
        actionHref="/sign-in"
        actionLabel="Sign in"
      />
    );
  }

  if (!accountId && isSignedIn && !accountsResolved) return <SpinnerOnly />;

  if (!selectedAccountId && accounts.length > 1) {
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

  if (!selectedAccountId && isSignedIn) {
    return (
      <StatusCard
        title="No marketplace account"
        body={error ?? (email ? `${email} is not linked to a marketplace account yet.` : "This login is not linked to a marketplace account yet.")}
      />
    );
  }

  if (!data) return <SpinnerOnly />;

  return <MarketplaceDashboard initialData={data} initialView={initialView} key={selectedAccountId} />;
}

function SpinnerOnly() {
  return (
    <div className="bootstrap-spinner" aria-busy="true" aria-live="polite">
      <Loader2 className="spin" size={28} />
    </div>
  );
}

function StatusCard({
  actionHref,
  actionLabel,
  body,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  body: string;
  title: string;
}) {
  return (
    <div className="auth-shell">
      <div className="chooser-card">
        <div className="eyebrow">Marketplace</div>
        <h2>{title}</h2>
        <p>{body}</p>
        {actionHref && actionLabel ? (
          <a className="primary-link" href={actionHref}>
            {actionLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}
