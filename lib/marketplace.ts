export const MARKETPLACE_API_BASE =
  process.env.MARKETPLACE_API_BASE ??
  "https://subrepand-troublesome-darrell.ngrok-free.dev";

export const MARKETPLACE_ACCOUNT_ID =
  process.env.MARKETPLACE_ACCOUNT_ID ?? "mp_lifedx";

export type MarketplaceAccount = {
  account_id: string;
  display_name: string;
  owner_email: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
};

export type MarketplaceParty = {
  party_id: string;
  label: string | null;
  role: string;
  name: string;
  active: boolean;
};

export type MarketplaceContext = {
  account: MarketplaceAccount;
  parties: MarketplaceParty[];
  dev_selector: {
    enabled: boolean;
    account_id: string;
  };
  capabilities: Record<string, boolean>;
};

export type BookingMember = {
  order_member_id: number;
  member_name: string;
  patient_id: string | null;
  national_id: string | null;
  emirates_id: string | null;
  items: Array<{
    order_item_id: number;
    product_id: string;
    name: string;
    price_fils: number;
    attributes?: Record<string, unknown> | null;
  }>;
  result_documents: Array<{
    result_document_id: number;
    status: string;
    content_type: string;
    blob_url: string;
    created_at: string;
  }>;
};

export type MarketplaceBooking = {
  booking_id: number;
  order_id: string;
  vertical_id: string;
  status: string;
  fulfillment_stage: string | null;
  schedule: {
    start_at: string | null;
    end_at: string | null;
    busy_until: string | null;
  };
  customer: {
    customer_id: string;
    name: string;
    phone: string | null;
    email: string | null;
  };
  address: Record<string, unknown>;
  seller: {
    party_id: string;
    name: string | null;
  };
  collector: {
    party_id: string | null;
    name: string | null;
  };
  partner: {
    party_id: string | null;
    name: string | null;
  };
  nurse_assignment: {
    nurse_id: string;
    display_name: string;
    assigned_at: string | null;
  } | null;
  acknowledgement: {
    acknowledgement_id: number;
    party_id: string;
    party_name: string;
    party_role: string;
    actor_email: string | null;
    acknowledged_at: string | null;
  } | null;
  permissions?: {
    can_upload_results?: boolean;
    can_assign_nurse?: boolean;
    can_mark_complete?: boolean;
    can_acknowledge?: boolean;
  } | null;
  results: {
    documents_count: number;
    reported_member_count: number;
    member_count: number;
    all_members_reported: boolean;
    result_reported_at: string | null;
  };
  members: BookingMember[];
  created_at: string | null;
  updated_at: string | null;
};

export type LedgerEntry = {
  ledger_entry_id: number;
  party_id: string;
  party_name: string;
  party_role: string;
  order_id: string;
  booking_id: number | null;
  order_item_id: number | null;
  vertical_id: string;
  product_id: string | null;
  product_name: string | null;
  entry_type: string;
  amount_fils: number;
  occurred_at: string | null;
  customer_name: string | null;
  booking_status: string | null;
};

export type MarketplaceNurse = {
  nurse_id: string;
  display_name: string;
  phone_number: string | null;
  gender: string | null;
  licence_number: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
};

export type AvailabilityRow = {
  vertical_id: string;
  collector_id: string;
  collector_name: string;
  emirate: string;
  priority: number;
  start_minute: number;
  end_minute: number;
  slot_interval_minutes: number;
  busy_buffer_minutes: number;
  status: string;
  breaks: Array<{
    collector_break_id?: number;
    start_minute: number;
    end_minute: number;
    status: string;
  }>;
};

export type BookingsResponse = {
  account: MarketplaceAccount;
  items: MarketplaceBooking[];
  total: number;
  limit: number;
};

export type DashboardData = {
  apiBase: string;
  error: string | null;
  context: MarketplaceContext;
  bookings: {
    account: MarketplaceAccount;
    new: MarketplaceBooking[];
    completed: MarketplaceBooking[];
  };
  ledger: {
    account: MarketplaceAccount;
    totals: Record<string, number>;
    total_amount_fils: number;
    items: LedgerEntry[];
    limit: number;
  };
  nurses: {
    account: MarketplaceAccount;
    items: MarketplaceNurse[];
  };
  availability: {
    account: MarketplaceAccount;
    items: AvailabilityRow[];
  };
};

export function marketplaceUrl(path: string, accountId: string = MARKETPLACE_ACCOUNT_ID) {
  const url = new URL(path, MARKETPLACE_API_BASE);
  url.searchParams.set("account_id", accountId);
  return url;
}

export async function marketplaceFetch<T>(
  path: string,
  accountId: string = MARKETPLACE_ACCOUNT_ID,
): Promise<T> {
  const response = await fetch(marketplaceUrl(path, accountId), { cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return response.json() as Promise<T>;
}

function emptyAccount(accountId: string): MarketplaceAccount {
  return {
    account_id: accountId,
    display_name: accountId,
    owner_email: null,
    status: "UNKNOWN",
    created_at: null,
    updated_at: null,
  };
}

export function emptyDashboardData(
  error: string | null = null,
  accountId: string = MARKETPLACE_ACCOUNT_ID,
): DashboardData {
  const account = emptyAccount(accountId);
  return {
    apiBase: MARKETPLACE_API_BASE,
    error,
    context: {
      account,
      parties: [],
      dev_selector: { enabled: true, account_id: accountId },
      capabilities: {},
    },
    bookings: { account, new: [], completed: [] },
    ledger: { account, totals: {}, total_amount_fils: 0, items: [], limit: 100 },
    nurses: { account, items: [] },
    availability: { account, items: [] },
  };
}

/** Resolves which marketplace accounts a signed-in email can access (post-Clerk-login). */
export async function resolveMarketplaceAccounts(email: string): Promise<MarketplaceAccount[]> {
  try {
    const url = new URL("/marketplace/auth/accounts", MARKETPLACE_API_BASE);
    url.searchParams.set("email", email);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as { items?: MarketplaceAccount[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

export async function loadDashboardData(
  accountId: string = MARKETPLACE_ACCOUNT_ID,
): Promise<DashboardData> {
  // Context is required and drives capability gating; fail the whole load only if it fails.
  let context: MarketplaceContext;
  try {
    context = await marketplaceFetch<MarketplaceContext>("/marketplace/context", accountId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reach the marketplace API";
    return emptyDashboardData(
      `Could not reach the marketplace API at ${MARKETPLACE_API_BASE} for ${accountId}. ${message}`,
      accountId,
    );
  }

  const caps = context.capabilities ?? {};
  const emptyBookings: BookingsResponse = { account: context.account, items: [], total: 0, limit: 100 };

  // Capability-gated, individually resilient: a 403 on nurses (lab-only accounts) must not break the page.
  const [bookingsNew, bookingsCompleted, ledger, nurses, availability] = await Promise.all([
    marketplaceFetch<BookingsResponse>("/marketplace/bookings?limit=100&view=new", accountId).catch(
      () => emptyBookings,
    ),
    marketplaceFetch<BookingsResponse>("/marketplace/bookings?limit=100&view=completed", accountId).catch(
      () => emptyBookings,
    ),
    marketplaceFetch<DashboardData["ledger"]>("/marketplace/ledger?limit=100", accountId).catch(() => ({
      account: context.account,
      totals: {},
      total_amount_fils: 0,
      items: [],
      limit: 100,
    })),
    caps.nurses
      ? marketplaceFetch<DashboardData["nurses"]>("/marketplace/nurses", accountId).catch(() => ({
          account: context.account,
          items: [],
        }))
      : Promise.resolve({ account: context.account, items: [] }),
    caps.availability
      ? marketplaceFetch<DashboardData["availability"]>("/marketplace/availability", accountId).catch(
          () => ({ account: context.account, items: [] }),
        )
      : Promise.resolve({ account: context.account, items: [] }),
  ]);

  return {
    apiBase: MARKETPLACE_API_BASE,
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

export type BiomarkerGroup = { id: string | null; label: string; biomarkers: string[] };

export type ItemBiomarkers = {
  names: string[];
  count: number;
  sampleType: string | null;
  fastingRequired: boolean;
  groups: BiomarkerGroup[];
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function biomarkerName(entry: unknown): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (entry && typeof entry === "object") {
    const name = (entry as { name?: unknown }).name;
    if (typeof name === "string") return name.trim() || null;
  }
  return null;
}

/**
 * Normalizes the messy `attributes` snapshot on a lab order item into a clean,
 * display-ready biomarker shape. Prefers `biomarkers_v2` (has sort_order),
 * falls back to `biomarkers`, and looks under `attributes.lab.*` as a backstop.
 */
export function extractItemBiomarkers(
  attributes: Record<string, unknown> | null | undefined,
): ItemBiomarkers | null {
  if (!attributes) return null;
  const lab = toRecord(attributes.lab);

  const v2 = toArray(attributes.biomarkers_v2).length
    ? toArray(attributes.biomarkers_v2)
    : toArray(lab.biomarkers_v2);

  let names: string[];
  if (v2.length) {
    names = [...v2]
      .sort((a, b) => {
        const ao = Number((a as { sort_order?: number }).sort_order ?? 0);
        const bo = Number((b as { sort_order?: number }).sort_order ?? 0);
        return ao - bo;
      })
      .map(biomarkerName)
      .filter((value): value is string => Boolean(value));
  } else {
    const flat = toArray(attributes.biomarkers).length
      ? toArray(attributes.biomarkers)
      : toArray(lab.biomarkers);
    names = flat.map(biomarkerName).filter((value): value is string => Boolean(value));
  }

  const groupsRaw = toArray(attributes.biomarker_groups).length
    ? toArray(attributes.biomarker_groups)
    : toArray(lab.biomarker_groups);
  const groups: BiomarkerGroup[] = groupsRaw
    .map((group) => {
      const record = toRecord(group);
      return {
        id: typeof record.id === "string" ? record.id : null,
        label:
          (typeof record.label === "string" && record.label) ||
          (typeof record.name === "string" && record.name) ||
          "Other",
        biomarkers: toArray(record.biomarkers)
          .map(biomarkerName)
          .filter((value): value is string => Boolean(value)),
      };
    })
    .filter((group) => group.biomarkers.length > 0);

  const sampleType =
    (typeof attributes.sample_type === "string" && attributes.sample_type) ||
    (typeof attributes.sample_type_display === "string" && attributes.sample_type_display) ||
    (typeof lab.sample_type === "string" && lab.sample_type) ||
    null;
  const fastingRequired = Boolean(attributes.fasting_required ?? lab.fasting_required);
  const count = names.length || Number(attributes.biomarker_count ?? lab.biomarker_count ?? 0);

  if (!names.length && !count) return null;
  return { names, count: count || names.length, sampleType, fastingRequired, groups };
}

export type LabItem = {
  order_item_id: number;
  product_id: string;
  name: string;
  price_fils: number;
  attributes?: Record<string, unknown> | null;
};

/** An item is an add-on when its `item_role` contains "addon" (iv_addon, bundle_recurring_addon, extra_addon). */
export function isAddonItem(item: LabItem): boolean {
  const role = item.attributes?.item_role;
  return typeof role === "string" && /addon/i.test(role);
}

export type Ingredient = { name: string; dosage: string | null; benefit: string | null };

/** Pulls the display ingredient list off an IV order item's attributes snapshot. */
export function extractItemIngredients(
  attributes: Record<string, unknown> | null | undefined,
): Ingredient[] {
  if (!attributes) return [];
  const iv = toRecord(attributes.IV);
  const raw = toArray(attributes.display_ingredients).length
    ? toArray(attributes.display_ingredients)
    : toArray(iv.display_ingredients).length
      ? toArray(iv.display_ingredients)
      : toArray(iv.displayIngredients);

  return raw
    .map((entry) => {
      const record = toRecord(entry);
      const name =
        (typeof record.ingredient === "string" && record.ingredient) ||
        (typeof record.name === "string" && record.name) ||
        "";
      if (!name) return null;
      return {
        name: name.trim(),
        dosage: typeof record.dosage === "string" ? record.dosage.trim() || null : null,
        benefit: typeof record.benefit === "string" ? record.benefit.trim() || null : null,
      };
    })
    .filter((value): value is Ingredient => Boolean(value));
}

export function formatMoney(amountFils: number) {
  const amount = amountFils / 100;
  return `AED ${amount.toFixed(2)}`;
}

export function formatDateTime(value: string | null) {
  if (!value) return "Unscheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unscheduled";

  const dubaiTime = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = dubaiTime.getUTCDate();
  const month = months[dubaiTime.getUTCMonth()];
  const year = dubaiTime.getUTCFullYear();
  const hour24 = dubaiTime.getUTCHours();
  const hour12 = hour24 % 12 || 12;
  const minute = dubaiTime.getUTCMinutes().toString().padStart(2, "0");
  const period = hour24 >= 12 ? "PM" : "AM";

  return `${day} ${month} ${year}, ${hour12}:${minute} ${period}`;
}

export function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
