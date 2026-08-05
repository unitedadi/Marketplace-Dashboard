"use client";

import { ClerkProvider, useAuth, useOrganization, useOrganizationList, useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

type AccountDashboardState = {
  accountId: string;
  data: DashboardData | null;
};

type AccountResolutionState = {
  accounts: MarketplaceAccount[];
  error: string | null;
  orgId: string | null;
  resolved: boolean;
};

type AuthenticatedDashboardState = {
  accountId: string | null;
  data: DashboardData | null;
  error: string | null;
};

type GetAuthToken = (options?: { organizationId?: string }) => Promise<string | null>;

function withAccount(path: string, accountId: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}account_id=${encodeURIComponent(accountId)}`;
}

async function proxyJson<T>(
  path: string,
  accountId?: string,
  getAuthToken?: GetAuthToken,
  organizationId?: string | null
): Promise<T> {
  const target = accountId ? withAccount(path, accountId) : path;
  const token = await getAuthToken?.(organizationId ? { organizationId } : undefined);
  const response = await fetch(`/api/marketplace/${target}`, {
    cache: "no-store",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function resolveAccounts(
  email: string,
  getAuthToken?: GetAuthToken,
  organizationId?: string | null
): Promise<MarketplaceAccount[]> {
  const encoded = encodeURIComponent(email);
  const data = await proxyJson<{ items?: MarketplaceAccount[] }>(
    `auth/accounts?email=${encoded}`,
    undefined,
    getAuthToken,
    organizationId
  );
  return data.items ?? [];
}

async function loadDashboard(
  accountId: string,
  getAuthToken?: GetAuthToken,
  organizationId?: string | null
): Promise<DashboardData> {
  const context = await proxyJson<DashboardData["context"]>("context", accountId, getAuthToken, organizationId);
  const caps = context.capabilities ?? {};
  const emptyBookings: BookingsResponse = { account: context.account, items: [], total: 0, limit: 100 };

  const [bookingsNew, bookingsCompleted, ledger, nurses, availability] = await Promise.all([
    proxyJson<BookingsResponse>("bookings?limit=100&view=new", accountId, getAuthToken, organizationId).catch(() => emptyBookings),
    proxyJson<BookingsResponse>("bookings?limit=100&view=completed", accountId, getAuthToken, organizationId).catch(() => emptyBookings),
    proxyJson<DashboardData["ledger"]>("ledger?limit=500", accountId, getAuthToken, organizationId).catch(() => ({
      account: context.account,
      totals: {},
      total_amount_fils: 0,
      items: [],
      limit: 500,
    })),
    caps.nurses
      ? proxyJson<DashboardData["nurses"]>("nurses", accountId, getAuthToken, organizationId).catch(() => ({
          account: context.account,
          items: [],
        }))
      : Promise.resolve({ account: context.account, items: [] }),
    caps.availability
      ? proxyJson<DashboardData["availability"]>("availability", accountId, getAuthToken, organizationId).catch(() => ({
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
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      {accountId ? (
        <AccountDashboard accountId={accountId} initialView={initialView} />
      ) : (
        <AuthenticatedMarketplaceBootstrapInner initialView={initialView} />
      )}
    </ClerkProvider>
  );
}

function AccountDashboard({ accountId, initialView }: { accountId: string; initialView?: string }) {
  const { getToken } = useAuth();
  const { isLoaded, isSignedIn } = useUser();
  const { organization } = useOrganization();
  const { isLoaded: organizationListLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const [state, setState] = useState<AccountDashboardState>({ accountId, data: null });
  const activationAttemptedRef = useRef<string | null>(null);
  const membershipsData = userMemberships.data;
  const memberships = useMemo(() => membershipsData ?? [], [membershipsData]);
  const activeOrganizationId = organization?.id ?? null;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !organizationListLoaded || activeOrganizationId || memberships.length !== 1) return;

    const organizationId = memberships[0]?.organization.id;
    if (!organizationId || activationAttemptedRef.current === organizationId) return;

    activationAttemptedRef.current = organizationId;
    void setActive({ organization: organizationId });
  }, [activeOrganizationId, isLoaded, isSignedIn, memberships, organizationListLoaded, setActive]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !organizationListLoaded) return;
    if (!activeOrganizationId && memberships.length === 1) return;

    let cancelled = false;
    loadDashboard(accountId, getToken, activeOrganizationId)
      .then((next) => {
        if (!cancelled) setState({ accountId, data: next });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load marketplace dashboard.";
        setState({ accountId, data: emptyDashboardData(message, accountId) });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, activeOrganizationId, getToken, isLoaded, isSignedIn, memberships.length, organizationListLoaded]);

  if (!isLoaded) return <SpinnerOnly />;

  if (!isSignedIn) {
    const search = new URLSearchParams({ account_id: accountId });
    if (initialView) search.set("view", initialView);
    return (
      <StatusCard
        title="Sign in"
        body="Sign in with your marketplace email to open this dashboard."
        actionHref={`/sign-in?redirect_url=${encodeURIComponent(`/?${search.toString()}`)}`}
        actionLabel="Sign in"
      />
    );
  }

  if (!organizationListLoaded || (!activeOrganizationId && memberships.length === 1)) return <SpinnerOnly />;

  const data = state.accountId === accountId ? state.data : null;
  if (!data) return <SpinnerOnly />;
  return <MarketplaceDashboard initialData={data} initialView={initialView} showUserButton={false} />;
}

function AuthenticatedMarketplaceBootstrapInner({ initialView }: Pick<BootstrapProps, "initialView">) {
  const { getToken } = useAuth();
  const { isLoaded, isSignedIn, user } = useUser();
  const { organization } = useOrganization();
  const { isLoaded: organizationListLoaded, setActive, userMemberships } = useOrganizationList({ userMemberships: true });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountState, setAccountState] = useState<AccountResolutionState>({
    accounts: [],
    error: null,
    orgId: null,
    resolved: false,
  });
  const [dashboardState, setDashboardState] = useState<AuthenticatedDashboardState>({
    accountId: null,
    data: null,
    error: null,
  });
  const activationAttemptedRef = useRef<string | null>(null);
  const email = useMemo(() => user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null, [user]);
  const membershipsData = userMemberships.data;
  const memberships = useMemo(() => membershipsData ?? [], [membershipsData]);
  const activeOrganizationId = organization?.id ?? null;
  const accounts = accountState.orgId === activeOrganizationId ? accountState.accounts : [];
  const accountsResolved = accountState.orgId === activeOrganizationId && accountState.resolved;
  const accountError = accountState.orgId === activeOrganizationId ? accountState.error : null;
  const data = dashboardState.accountId === selectedAccountId ? dashboardState.data : null;
  const dashboardError = dashboardState.accountId === selectedAccountId ? dashboardState.error : null;
  const error = dashboardError ?? accountError;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !organizationListLoaded || activeOrganizationId || memberships.length !== 1) return;

    const organizationId = memberships[0]?.organization.id;
    if (!organizationId || activationAttemptedRef.current === organizationId) return;

    activationAttemptedRef.current = organizationId;
    void setActive({ organization: organizationId });
  }, [activeOrganizationId, isLoaded, isSignedIn, memberships, organizationListLoaded, setActive]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !email || !activeOrganizationId) return;

    let cancelled = false;
    resolveAccounts(email, getToken, activeOrganizationId)
      .then((items) => {
        if (cancelled) return;
        setAccountState({ accounts: items, error: null, orgId: activeOrganizationId, resolved: true });
        if (items.length === 1) {
          setSelectedAccountId(items[0].account_id);
        } else if (!items.some((item) => item.account_id === selectedAccountId)) {
          setSelectedAccountId(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAccountState({
            accounts: [],
            error: err instanceof Error ? err.message : "Could not resolve marketplace account.",
            orgId: activeOrganizationId,
            resolved: true,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, email, getToken, isLoaded, isSignedIn, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    loadDashboard(selectedAccountId, getToken, activeOrganizationId)
      .then((next) => {
        if (!cancelled) setDashboardState({ accountId: selectedAccountId, data: next, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load marketplace dashboard.";
        setDashboardState({
          accountId: selectedAccountId,
          data: emptyDashboardData(message, selectedAccountId),
          error: message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, getToken, selectedAccountId]);

  if (!isLoaded) return <SpinnerOnly />;

  if (!isSignedIn) {
    return (
      <StatusCard
        title="Sign in"
        body="Sign in with your marketplace email, or open a debug URL with an account_id."
        actionHref="/sign-in"
        actionLabel="Sign in"
      />
    );
  }

  if (!organizationListLoaded || (!activeOrganizationId && memberships.length === 1)) return <SpinnerOnly />;

  if (!activeOrganizationId && memberships.length > 1) {
    return (
      <div className="auth-shell">
        <div className="chooser-card">
          <div className="eyebrow">Choose organization</div>
          <h2>Select a workspace</h2>
          <p>Your login has access to more than one organization.</p>
          <div className="chooser-list">
            {memberships.map((membership) => (
              <button
                className="chooser-item"
                key={membership.id}
                onClick={() => void setActive({ organization: membership.organization.id })}
                type="button"
              >
                <span className="chooser-item-name">{membership.organization.name}</span>
                <span className="chooser-item-id">{membership.organization.id}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!activeOrganizationId) {
    return (
      <StatusCard
        title="No marketplace account"
        body={email ? `${email} is not linked to a marketplace organization yet.` : "This login is not linked to a marketplace organization yet."}
      />
    );
  }

  if (isSignedIn && !accountsResolved) return <SpinnerOnly />;

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

  return <MarketplaceDashboard initialData={data} initialView={initialView} key={selectedAccountId} showUserButton />;
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
