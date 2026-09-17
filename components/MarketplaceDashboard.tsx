"use client";

import { useAuth, useOrganization, UserButton } from "@clerk/nextjs";
import {
  Banknote,
  Bell,
  CalendarCheck2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Droplet,
  FileUp,
  Loader2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BiomarkerGroup,
  BookingMember,
  BookingsResponse,
  AvailabilityCalendarResponse,
  AvailabilityRow,
  DashboardData,
  extractItemBiomarkers,
  extractItemIngredients,
  formatDateTime,
  formatMoney,
  Ingredient,
  isAddonItem,
  ItemBiomarkers,
  LedgerEntry,
  MarketplaceBooking,
  MarketplaceNurse,
  MarketplaceParty,
  NurseAvailability,
} from "@/lib/marketplace";

type ViewId = "bookings" | "revenue" | "nurses" | "availability" | "notifications" | "team";

const navItems: Array<{ id: ViewId; label: string; icon: typeof CalendarCheck2 }> = [
  { id: "bookings", label: "Bookings", icon: CalendarCheck2 },
  { id: "revenue", label: "Revenue", icon: Banknote },
  { id: "nurses", label: "Nurses", icon: Stethoscope },
  { id: "availability", label: "Availability", icon: Clock3 },
  { id: "notifications", label: "WhatsApp Notifications", icon: Bell },
  { id: "team", label: "Team", icon: Users },
];

const MAX_RESULT_PDF_BYTES = 25 * 1024 * 1024;

function withAccount(path: string, accountId: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}account_id=${encodeURIComponent(accountId)}`;
}

async function proxyJson<T>(path: string, accountId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/marketplace/${withAccount(path, accountId)}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function uploadResultPdf(
  orderId: string,
  orderMemberId: number,
  file: File,
  accountId: string,
  apiBase: string,
  token: string,
) {
  const url = new URL(
    `/marketplace/bookings/${encodeURIComponent(orderId)}/members/${orderMemberId}/results/pdf`,
    apiBase,
  );
  url.searchParams.set("account_id", accountId);
  url.searchParams.set("filename", file.name);

  const response = await fetch(url, {
    body: file,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/pdf",
    },
    method: "POST",
  });
  if (!response.ok) {
    if (response.status === 413) {
      throw new Error("This PDF is too large. The maximum file size is 25 MB.");
    }
    const payload = await response.json().catch(() => null) as { detail?: string; error?: string } | null;
    throw new Error(payload?.detail || payload?.error || "The PDF could not be uploaded. Please try again.");
  }
  return response.json();
}

function friendlyAckError(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  if (raw.includes("marketplace_mutations_disabled")) {
    return "Write actions are disabled on this API runtime.";
  }
  if (raw.includes("nurse_scheduling_not_enabled")) {
    return "Nurse scheduling is not enabled for this booking provider. Set nurse availability for this account before assigning.";
  }
  if (raw.includes("nurse_schedule_conflict") || raw.includes("nurse_not_available")) {
    return "This nurse is not available for the booking time. Update the nurse schedule, emirate, off-days, breaks, or service area.";
  }
  return raw || "Could not acknowledge. Please try again.";
}

async function acknowledgeBooking(orderId: string, accountId: string, actorEmail?: string | null) {
  const response = await fetch(
    `/api/marketplace/${withAccount(`bookings/${orderId}/acknowledge`, accountId)}`,
    {
      body: JSON.stringify(actorEmail ? { actor_email: actorEmail } : {}),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function assignNurse(orderId: string, nurseId: string, accountId: string) {
  const response = await fetch(
    `/api/marketplace/${withAccount(`bookings/${orderId}/nurse-assignment`, accountId)}`,
    {
      body: JSON.stringify({ nurse_id: nurseId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function completeBooking(orderId: string, accountId: string) {
  const response = await fetch(
    `/api/marketplace/${withAccount(`bookings/${orderId}/complete`, accountId)}`,
    {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function statusClass(value: string | null | undefined) {
  const status = String(value ?? "").toUpperCase();
  if (["ACTIVE", "COMPLETED", "REPORTS_AVAILABLE", "RECEIVED"].includes(status)) return "good";
  if (["INACTIVE", "CANCELLED", "FAILED"].includes(status)) return "bad";
  return "neutral";
}

function isViewId(value: string | undefined): value is ViewId {
  return (
    value === "bookings" ||
    value === "revenue" ||
    value === "nurses" ||
    value === "availability" ||
    value === "notifications" ||
    value === "team"
  );
}

export function MarketplaceDashboard({
  apiBase,
  initialData,
  initialView,
  showUserButton = false,
}: {
  apiBase: string;
  initialData: DashboardData;
  initialView?: string;
  showUserButton?: boolean;
}) {
  const [view, setViewState] = useState<ViewId>(isViewId(initialView) ? initialView : "bookings");

  function setView(next: ViewId) {
    setViewState(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next);
      window.history.replaceState(null, "", url);
    }
  }
  const [data, setData] = useState(initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(initialData.error);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const accountId = data.context.dev_selector.account_id;
  const accountName = data.context.account.display_name || accountId;
  const capabilities = data.context.capabilities ?? {};
  const canManageNurses = capabilities.nurses === true;
  const canAssignNurses = capabilities.nurse_assignment === true;
  const canWhatsapp = capabilities.whatsapp_notifications === true;
  const visibleNavItems = navItems.filter((item) => {
    if (item.id === "nurses") return canManageNurses;
    if (item.id === "notifications") return canWhatsapp;
    return true;
  });

  const selectedBooking =
    [...data.bookings.new, ...data.bookings.completed].find(
      (booking) => booking.order_id === selectedOrderId,
    ) ?? null;

  async function refresh() {
    setIsRefreshing(true);
    setNotice(null);
    try {
      const caps = data.context.capabilities ?? {};
      const [context, bookingsNew, bookingsCompleted, ledger, nurses, availability] =
        await Promise.all([
          proxyJson<DashboardData["context"]>("context", accountId),
          proxyJson<BookingsResponse>("bookings?limit=100&view=new", accountId),
          proxyJson<BookingsResponse>("bookings?limit=100&view=completed", accountId),
          proxyJson<DashboardData["ledger"]>("ledger?limit=500", accountId),
          caps.nurses
            ? proxyJson<DashboardData["nurses"]>("nurses", accountId)
            : Promise.resolve(data.nurses),
          caps.availability
            ? proxyJson<DashboardData["availability"]>("availability", accountId)
            : Promise.resolve(data.availability),
        ]);
      setData({
        ...data,
        availability,
        bookings: {
          account: bookingsNew.account,
          completed: bookingsCompleted.items,
          new: bookingsNew.items,
        },
        context,
        ledger,
        nurses,
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }

  const safeView: ViewId = visibleNavItems.some((item) => item.id === view) ? view : "bookings";
  const title = navItems.find((item) => item.id === safeView)?.label ?? "Bookings";

  return (
    <div className="dashboard-shell">
      <aside className="sidebar" aria-label="Marketplace navigation">
        <div className="sidebar-brand">
          <div>
            <div className="brand-name">DarDoc</div>
            <div className="brand-subtitle">Marketplace</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          <div className="nav-section-label">Workspace</div>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;

            return (
              <button
                aria-current={safeView === item.id ? "page" : undefined}
                className={safeView === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                onClick={() => setView(item.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-account">
          {showUserButton ? (
            <UserButton />
          ) : (
            <div className="avatar" aria-hidden="true">
              {(data.context.account.display_name || accountId)
                .split(/\s+/)
                .map((word) => word[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
          )}
          <div>
            <div className="account-name">{data.context.account.display_name}</div>
            <div className="account-sub">{data.context.dev_selector.account_id}</div>
          </div>
        </div>
      </aside>

      <main className="main-pane" aria-label="Dashboard content">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
          </div>
          <button className="icon-action" disabled={isRefreshing} onClick={refresh} type="button">
            {isRefreshing ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            <span>Refresh</span>
          </button>
        </header>

        {notice ? <div className="notice bad">{notice}</div> : null}

        <section className="content-band">
          {safeView === "bookings" ? (
            <BookingsView
              accountId={accountId}
              accountName={accountName}
              actorEmail={data.context.account.owner_email}
              bookingsCompleted={data.bookings.completed}
              bookingsNew={data.bookings.new}
              canAssignNurses={canAssignNurses}
              onChanged={refresh}
              onSelect={setSelectedOrderId}
            />
          ) : null}
          {safeView === "revenue" ? <RevenueView accountId={accountId} accountName={accountName} entries={data.ledger.items} /> : null}
          {safeView === "nurses" ? <NursesView accountId={accountId} data={data} onChanged={refresh} /> : null}
          {safeView === "availability" ? (
            <AvailabilityView
              accountId={accountId}
              availabilityRows={data.availability.items}
              nurses={data.nurses.items}
              parties={data.context.parties}
              onChanged={refresh}
            />
          ) : null}
          {safeView === "notifications" ? <NotificationsView accountId={accountId} parties={data.context.parties} /> : null}
          {safeView === "team" ? <TeamView accountId={accountId} currentEmail={data.context.account.owner_email} /> : null}
        </section>
      </main>

      {selectedBooking ? (
        <BookingDetail
          accountId={accountId}
          actorEmail={data.context.account.owner_email}
          apiBase={apiBase}
          booking={selectedBooking}
          canAssignNurses={canAssignNurses}
          nurses={data.nurses.items.filter((nurse) => (nurse.status ?? "").toUpperCase() === "ACTIVE")}
          onChanged={refresh}
          onClose={() => setSelectedOrderId(null)}
        />
      ) : null}
    </div>
  );
}

function formatStage(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Not set";
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function bookingHaystack(booking: MarketplaceBooking) {
  return [
    booking.order_id,
    `booking #${booking.booking_id}`,
    String(booking.booking_id),
    booking.vertical_id,
    booking.fulfillment_stage,
    booking.status,
    booking.customer.name,
    booking.customer.phone,
    booking.customer.email,
    booking.collector.name,
    booking.partner.name,
    booking.seller.name,
    booking.nurse_assignment?.display_name,
    formatDateTime(booking.schedule.start_at),
    ...booking.members.map((member) => member.member_name),
    ...booking.members.flatMap((member) => member.items.map((item) => item.name)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function bookingMatchesQuery(booking: MarketplaceBooking, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = bookingHaystack(booking);
  return tokens.every((token) => haystack.includes(token));
}

type BookingFilter = "new" | "completed";

function BookingsView({
  accountId,
  accountName,
  actorEmail,
  bookingsCompleted,
  bookingsNew,
  canAssignNurses,
  onChanged,
  onSelect,
}: {
  accountId: string;
  accountName: string;
  actorEmail?: string | null;
  bookingsCompleted: MarketplaceBooking[];
  bookingsNew: MarketplaceBooking[];
  canAssignNurses: boolean;
  onChanged: () => Promise<void>;
  onSelect: (orderId: string) => void;
}) {
  const [filter, setFilter] = useState<BookingFilter>("new");
  const [query, setQuery] = useState("");

  if (bookingsNew.length === 0 && bookingsCompleted.length === 0) {
    return (
      <div className="bookings-view">
        <EmptyState title="No bookings yet" body={`The dev API is connected, but ${accountName} has no booking rows yet.`} />
      </div>
    );
  }

  const inTab = filter === "completed" ? bookingsCompleted : bookingsNew;
  const visible = inTab.filter((booking) => bookingMatchesQuery(booking, query));
  const hasQuery = query.trim().length > 0;

  return (
    <div className="bookings-view">
      <div className="bookings-toolbar">
        <SegmentPicker
          onChange={setFilter}
          options={[
            { label: "New", value: "new" },
            { label: "Completed", value: "completed" },
          ]}
          value={filter}
        />
        <SearchField
          onChange={setQuery}
          placeholder="Search booking ID, customer, date, product..."
          value={query}
        />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          body={
            hasQuery
              ? `No bookings match “${query.trim()}”. Try a different term.`
              : filter === "completed"
                ? `${accountName} has no completed bookings yet.`
                : `${accountName} has no new bookings right now.`
          }
          title={hasQuery ? "No matches" : filter === "completed" ? "No completed bookings" : "No new bookings"}
        />
      ) : (
        <div className="booking-list" aria-label="Bookings">
          {visible.map((booking) => (
            <BookingListRow
              accountId={accountId}
              actorEmail={actorEmail}
              booking={booking}
              canAssignNurses={canAssignNurses}
              key={booking.order_id}
              onChanged={onChanged}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchField({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="search-field">
      <Search aria-hidden="true" className="search-icon" size={16} strokeWidth={1.8} />
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {value.trim() ? (
        <button
          aria-label="Clear search"
          className="search-clear"
          onClick={() => onChange("")}
          type="button"
        >
          <X size={14} />
        </button>
      ) : null}
    </label>
  );
}

function SegmentPicker<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      className="segment-picker"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <div
        aria-hidden="true"
        className="segment-indicator"
        style={{
          transform: `translateX(calc(${activeIndex} * 100%))`,
          width: `calc((100% - 8px) / ${options.length})`,
        }}
      />
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={value === option.value ? "segment-button active" : "segment-button"}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BookingListRow({
  accountId,
  actorEmail,
  booking,
  canAssignNurses,
  onChanged,
  onSelect,
}: {
  accountId: string;
  actorEmail?: string | null;
  booking: MarketplaceBooking;
  canAssignNurses: boolean;
  onChanged: () => Promise<void>;
  onSelect: (orderId: string) => void;
}) {
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [optimisticAck, setOptimisticAck] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  async function handleAcknowledge(event: ReactMouseEvent) {
    event.stopPropagation();
    setIsAcknowledging(true);
    setAckError(null);
    setOptimisticAck(true); // flip to the status pill immediately
    try {
      await acknowledgeBooking(booking.order_id, accountId, actorEmail);
      await onChanged();
    } catch (error) {
      setOptimisticAck(false); // roll back on failure
      setAckError(friendlyAckError(error));
    } finally {
      setIsAcknowledging(false);
    }
  }

  const acknowledged = Boolean(booking.acknowledgement) || optimisticAck;

  const productNames = booking.members
    .flatMap((member) => member.items.filter((item) => !isAddonItem(item)).map((item) => item.name))
    .filter(Boolean);
  const uniqueProducts = Array.from(new Set(productNames));
  const customer = booking.customer.name || "Unnamed customer";
  const productLine = uniqueProducts.length ? uniqueProducts.join(", ") : booking.order_id;
  const stage = booking.fulfillment_stage ?? booking.status;
  const nurse = booking.nurse_assignment?.display_name ?? "Unassigned";
  const memberCount = booking.members.length;
  const assignment = booking.nurse_assignment;
  const isCompleted = (stage ?? "").toUpperCase() === "COMPLETED";
  const canAck = booking.permissions?.can_acknowledge === true;
  const canAssign = canAssignNurses && booking.permissions?.can_assign_nurse === true;

  const meta = [
    booking.vertical_id?.toUpperCase(),
    `${memberCount} ${memberCount === 1 ? "member" : "members"}`,
    `Nurse · ${nurse}`,
    booking.results.member_count > 0
      ? `${booking.results.reported_member_count}/${booking.results.member_count} reported`
      : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className="booking-row"
      onClick={() => onSelect(booking.order_id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(booking.order_id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="booking-row-copy">
        <div className="booking-row-titleline">
          <span className="booking-row-title">{customer}</span>
          <span className="booking-id-pill">{booking.order_id}</span>
        </div>
        <div className="booking-row-subtitle">{productLine}</div>
        <div className="booking-row-meta">
          {meta.map((entry, index) => (
            <span className="booking-meta-item" key={entry}>
              {index > 0 ? <span className="booking-meta-dot" aria-hidden="true">·</span> : null}
              {entry}
            </span>
          ))}
        </div>
      </div>
      <div className="booking-row-side">
        <span className="booking-row-time">{formatDateTime(booking.schedule.start_at)}</span>
        {!acknowledged && canAck ? (
          <button
            className="ack-pill-button"
            disabled={isAcknowledging}
            onClick={handleAcknowledge}
            type="button"
          >
            <Check size={13} />
            Acknowledge
          </button>
        ) : acknowledged && canAssign && !assignment && !isCompleted ? (
          <button
            className="ack-pill-button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(booking.order_id);
            }}
            type="button"
          >
            <Stethoscope size={13} />
            Assign nurse
          </button>
        ) : (
          <span className={`status-pill ${statusClass(stage)}`}>{formatStage(stage)}</span>
        )}
        {ackError ? <span className="ack-error">{ackError}</span> : null}
      </div>
      <ChevronRight aria-hidden="true" className="booking-row-chevron" size={18} strokeWidth={1.6} />
    </div>
  );
}

function MapCopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for browsers without the async clipboard API.
      const input = document.createElement("textarea");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className="map-copy-button" onClick={copy} type="button">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy location link"}
    </button>
  );
}

function BookingDetail({
  accountId,
  actorEmail,
  apiBase,
  booking,
  canAssignNurses,
  nurses,
  onChanged,
  onClose,
}: {
  accountId: string;
  actorEmail?: string | null;
  apiBase: string;
  booking: MarketplaceBooking;
  canAssignNurses: boolean;
  nurses: MarketplaceNurse[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [selectedNurse, setSelectedNurse] = useState(booking.nurse_assignment?.nurse_id ?? "");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());

  const customer = booking.customer.name || "Unnamed customer";
  const stage = booking.fulfillment_stage ?? booking.status;
  const vertical = (booking.vertical_id ?? "").toLowerCase();
  const isLab = vertical === "laboratory";
  const isCompleted = (stage ?? "").toUpperCase() === "COMPLETED";
  const startAt = booking.schedule.start_at;
  const startTime = startAt ? new Date(startAt).getTime() : NaN;
  const isPast = Number.isFinite(startTime) && startTime <= openedAt;
  const acknowledgement = booking.acknowledgement;
  const assignment = booking.nurse_assignment;

  // Per-booking permissions (backend is the source of truth and also enforces these).
  const perms = booking.permissions ?? {};
  const canUploadResults = isLab && perms.can_upload_results === true;
  const canAck = perms.can_acknowledge === true;
  const canAssign = canAssignNurses && perms.can_assign_nurse === true;
  const canComplete = perms.can_mark_complete === true;

  const address = (booking.address ?? {}) as Record<string, unknown>;
  const addr = (key: string): string | null => {
    const value = address[key];
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number") return String(value);
    return null;
  };
  const addrLine1 = addr("line1");
  const addrLine2 = addr("line2");
  const addrMeta = [
    addr("building_name"),
    addr("floor_number") ? `Floor ${addr("floor_number")}` : null,
    addr("area"),
    addr("city"),
    addr("emirate"),
    addr("country"),
  ].filter(Boolean) as string[];
  const addrLat = addr("latitude");
  const addrLng = addr("longitude");
  const mapsUrl =
    addrLat && addrLng
      ? `https://www.google.com/maps/search/?api=1&query=${addrLat},${addrLng}`
      : null;
  const hasAddress = Boolean(addrLine1 || addrMeta.length);

  async function handleAcknowledge() {
    setIsAcknowledging(true);
    setAckError(null);
    try {
      await acknowledgeBooking(booking.order_id, accountId, actorEmail);
      await onChanged();
    } catch (error) {
      setAckError(friendlyAckError(error));
    } finally {
      setIsAcknowledging(false);
    }
  }

  async function handleAssign() {
    if (!selectedNurse) return;
    setIsAssigning(true);
    setAssignError(null);
    try {
      await assignNurse(booking.order_id, selectedNurse, accountId);
      await onChanged();
      setIsPicking(false);
    } catch (error) {
      setAssignError(friendlyAckError(error));
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleComplete() {
    setIsCompleting(true);
    setCompleteError(null);
    try {
      await completeBooking(booking.order_id, accountId);
      await onChanged();
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Failed to mark complete";
      setCompleteError(
        raw.includes("booking_not_iv")
          ? "This booking is not an IV booking."
          : raw.includes("marketplace_mutations_disabled")
            ? "Write actions are disabled on this API runtime."
            : raw,
      );
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        aria-label={`Booking for ${customer}`}
        aria-modal="true"
        className="modal-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">{formatStage(stage)}</div>
            <h2>{customer}</h2>
            <p>
              {booking.order_id} · Booking #{booking.booking_id} · {formatDateTime(booking.schedule.start_at)}
            </p>
            {booking.customer.phone ? (
              <a className="modal-call" href={`tel:${booking.customer.phone}`}>
                <Phone size={14} />
                {booking.customer.phone}
              </a>
            ) : null}
          </div>
          <button aria-label="Close" className="modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modal-ack">
          {acknowledgement ? (
            <div className="modal-ack-done">
              <Check size={15} />
              <span>Acknowledged</span>
              {acknowledgement.acknowledged_at ? (
                <span className="modal-ack-time">· {formatDateTime(acknowledgement.acknowledged_at)}</span>
              ) : null}
            </div>
          ) : (
            <>
              <div className="modal-ack-copy">
                <span className="modal-ack-label">Not acknowledged</span>
                {ackError ? <span className="modal-ack-error">{ackError}</span> : null}
              </div>
              {canAck ? (
                <button
                  className="modal-ack-button"
                  disabled={isAcknowledging}
                  onClick={handleAcknowledge}
                  type="button"
                >
                  {isAcknowledging ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
                  Acknowledge
                </button>
              ) : null}
            </>
          )}
        </div>

        {canAssign && (acknowledgement || assignment) ? (
          isPicking ? (
            <div className="modal-assign-edit">
              <div className="modal-ack-label">{assignment ? "Reassign nurse" : "Assign nurse"}</div>
              {nurses.length ? (
                <div className="modal-assign-controls">
                  <select
                    className="modal-assign-select"
                    onChange={(event) => setSelectedNurse(event.target.value)}
                    value={selectedNurse}
                  >
                    <option value="">Select nurse</option>
                    {nurses.map((nurse) => (
                      <option key={nurse.nurse_id} value={nurse.nurse_id}>
                        {nurse.display_name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="modal-ack-button"
                    disabled={!selectedNurse || isAssigning}
                    onClick={handleAssign}
                    type="button"
                  >
                    {isAssigning ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
                    Save
                  </button>
                  <button
                    className="modal-assign-cancel"
                    onClick={() => setIsPicking(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="modal-assign-empty">No active nurses. Add one in the Nurses tab.</div>
              )}
              {assignError ? <div className="modal-action-error">{assignError}</div> : null}
            </div>
          ) : (
            <div className="modal-ack">
              <div className="modal-ack-copy">
                <span className="modal-ack-label">Nurse</span>
                {assignment ? (
                  <span className="modal-assign-name">{assignment.display_name}</span>
                ) : (
                  <span className="modal-assign-empty">Not assigned</span>
                )}
                {assignError ? <span className="modal-ack-error">{assignError}</span> : null}
              </div>
              <button
                className="modal-ack-button"
                onClick={() => {
                  setSelectedNurse(assignment?.nurse_id ?? "");
                  setIsPicking(true);
                }}
                type="button"
              >
                <Stethoscope size={15} />
                {assignment ? "Reassign" : "Assign nurse"}
              </button>
            </div>
          )
        ) : null}

        {hasAddress ? (
          <div className="modal-address">
            <div className="modal-address-head">
              <div className="modal-section-label">Address</div>
              {mapsUrl ? (
                <a className="modal-address-map" href={mapsUrl} rel="noopener noreferrer" target="_blank">
                  <MapPin size={13} />
                  Open in Maps
                </a>
              ) : null}
            </div>
            {addrLine1 ? <div className="modal-address-line">{addrLine1}</div> : null}
            {addrLine2 ? <div className="modal-address-sub">{addrLine2}</div> : null}
            {addrMeta.length ? <div className="modal-address-meta">{addrMeta.join(" · ")}</div> : null}
            {mapsUrl ? <MapCopyButton url={mapsUrl} /> : null}
          </div>
        ) : null}

        <div className="modal-section-label">
          {isLab
            ? `Members · ${booking.results.reported_member_count}/${booking.results.member_count} reported`
            : "Members"}
        </div>

        <div className="member-list">
          {booking.members.map((member) => (
            <MemberUploadRow
              accountId={accountId}
              apiBase={apiBase}
              booking={booking}
              canUpload={canUploadResults}
              isLab={isLab}
              key={member.order_member_id}
              member={member}
              onChanged={onChanged}
            />
          ))}
        </div>

        {canComplete || isCompleted ? (
          <div className="modal-actions">
            {isCompleted ? (
              <div className="modal-completed">
                <Check size={16} />
                Completed
              </div>
            ) : (
              <>
                {completeError ? <div className="modal-action-error">{completeError}</div> : null}
                <button
                  className="modal-cta"
                  disabled={isCompleting || !isPast}
                  onClick={handleComplete}
                  type="button"
                >
                  {isCompleting ? <Loader2 className="spin" size={16} /> : <CalendarCheck2 size={16} />}
                  Mark complete
                </button>
                {!isPast ? (
                  <div className="modal-action-hint">
                    Available once the scheduled time has passed
                    {Number.isFinite(startTime) ? ` (${formatDateTime(startAt)})` : ""}.
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MemberUploadRow({
  accountId,
  apiBase,
  booking,
  canUpload,
  isLab,
  member,
  onChanged,
}: {
  accountId: string;
  apiBase: string;
  booking: MarketplaceBooking;
  canUpload: boolean;
  isLab: boolean;
  member: BookingMember;
  onChanged: () => Promise<void>;
}) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasResult = member.result_documents.length > 0;

  const mainItems = member.items.filter((item) => !isAddonItem(item));
  const addonItems = member.items.filter((item) => isAddonItem(item));
  const products =
    (mainItems.length ? mainItems : member.items).map((item) => item.name).filter(Boolean).join(", ");

  const biomarkers = useMemo<ItemBiomarkers | null>(() => {
    if (!isLab) return null;
    const perItem = member.items
      .map((item) => extractItemBiomarkers(item.attributes))
      .filter((value): value is ItemBiomarkers => Boolean(value));
    if (!perItem.length) return null;
    const names = Array.from(new Set(perItem.flatMap((value) => value.names)));
    const groups = perItem.flatMap((value) => value.groups);
    return {
      names,
      count: names.length || perItem.reduce((max, value) => Math.max(max, value.count), 0),
      sampleType: perItem.find((value) => value.sampleType)?.sampleType ?? null,
      fastingRequired: perItem.some((value) => value.fastingRequired),
      groups,
    };
  }, [member.items, isLab]);

  const ingredients = useMemo<Ingredient[]>(() => {
    if (isLab) return [];
    const seen = new Set<string>();
    const merged: Ingredient[] = [];
    for (const item of mainItems.length ? mainItems : member.items) {
      for (const ingredient of extractItemIngredients(item.attributes)) {
        const key = ingredient.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(ingredient);
      }
    }
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.items, isLab]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_RESULT_PDF_BYTES) {
      setError("This PDF is too large. The maximum file size is 25 MB.");
      event.target.value = "";
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      const token = await getToken(organization?.id ? { organizationId: organization.id } : undefined);
      if (!token) throw new Error("Your session expired. Please sign in again before uploading the PDF.");
      await uploadResultPdf(booking.order_id, member.order_member_id, file, accountId, apiBase, token);
      await onChanged();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="member-block">
      <div className="member-upload">
        <div className="member-upload-copy">
          <strong>{member.member_name || `Member ${member.order_member_id}`}</strong>
          <small>{products || "No products"}</small>
          {canUpload && error ? <small className="member-upload-error">{error}</small> : null}
        </div>
        {isLab && hasResult ? (
          <span className="status-pill good">
            <Check size={13} /> Report uploaded
          </span>
        ) : null}
        {canUpload ? (
          <>
            <button
              className="member-upload-button"
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              {isUploading ? <Loader2 className="spin" size={15} /> : <FileUp size={15} />}
              {hasResult ? "Replace PDF" : "Upload PDF"}
            </button>
            <input accept="application/pdf" onChange={handleFile} ref={inputRef} type="file" />
          </>
        ) : null}
      </div>
      {addonItems.length ? (
        <div className="addon-section">
          <div className="addon-label">Add-ons</div>
          <div className="addon-chips">
            {addonItems.map((item) => (
              <span className="addon-chip" key={item.order_item_id}>
                <Plus size={12} strokeWidth={2} />
                {item.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {biomarkers ? <BiomarkerPanel biomarkers={biomarkers} /> : null}
      {ingredients.length ? <IngredientPanel ingredients={ingredients} /> : null}
    </div>
  );
}

function IngredientPanel({ ingredients }: { ingredients: Ingredient[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="biomarker-panel">
      <button
        aria-expanded={expanded}
        className="biomarker-toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Droplet size={14} strokeWidth={1.8} />
        <span className="biomarker-count">
          {ingredients.length} {ingredients.length === 1 ? "ingredient" : "ingredients"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={expanded ? "biomarker-chevron open" : "biomarker-chevron"}
          size={15}
        />
      </button>
      {expanded ? (
        <div className="ingredient-list">
          {ingredients.map((ingredient) => (
            <div className="ingredient-row" key={ingredient.name}>
              <div className="ingredient-head">
                <span className="ingredient-name">{ingredient.name}</span>
                {ingredient.dosage ? (
                  <span className="ingredient-dosage">{ingredient.dosage}</span>
                ) : null}
              </div>
              {ingredient.benefit ? (
                <div className="ingredient-benefit">{ingredient.benefit}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BiomarkerPanel({ biomarkers }: { biomarkers: ItemBiomarkers }) {
  const [expanded, setExpanded] = useState(false);
  const meta = [
    biomarkers.sampleType ? capitalize(biomarkers.sampleType) : null,
    biomarkers.fastingRequired ? "Fasting required" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="biomarker-panel">
      <button
        aria-expanded={expanded}
        className="biomarker-toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Droplet size={14} strokeWidth={1.8} />
        <span className="biomarker-count">
          {biomarkers.count} {biomarkers.count === 1 ? "biomarker" : "biomarkers"}
        </span>
        {meta.length ? <span className="biomarker-meta">· {meta.join(" · ")}</span> : null}
        <ChevronDown
          aria-hidden="true"
          className={expanded ? "biomarker-chevron open" : "biomarker-chevron"}
          size={15}
        />
      </button>
      {expanded ? <BiomarkerList biomarkers={biomarkers} /> : null}
    </div>
  );
}

function BiomarkerList({ biomarkers }: { biomarkers: ItemBiomarkers }) {
  const grouped: BiomarkerGroup[] = biomarkers.groups.length
    ? biomarkers.groups
    : [{ id: null, label: "", biomarkers: biomarkers.names }];

  return (
    <div className="biomarker-groups">
      {grouped.map((group, index) => (
        <div className="biomarker-group" key={group.id ?? group.label ?? index}>
          {group.label ? <div className="biomarker-group-label">{group.label}</div> : null}
          <div className="biomarker-chips">
            {group.biomarkers.map((name) => (
              <span className="biomarker-chip" key={name}>
                {name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function currentDubaiMonthIndex(): number {
  const date = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

type LedgerDateField = "occurred_at" | "appointment_at";

function ledgerMatchesQuery(entry: LedgerEntry, query: string, dateField: LedgerDateField) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [
    entry.order_id,
    entry.product_name,
    entry.party_name,
    entry.entry_type,
    entry.customer_name,
    entry.vertical_id,
    formatDateTime(entry[dateField] ?? null),
    formatMoney(entry.amount_fils),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function csvCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function exportLedgerCsv(entries: LedgerEntry[], fileLabel: string, dateField: LedgerDateField) {
  const headers = [
    "Order ID",
    "Customer",
    "Product",
    "Party",
    "Role",
    "Vertical",
    "Type",
    "Amount (AED)",
    dateField === "appointment_at" ? "Appointment (Dubai)" : "Occurred",
  ];
  const rows = entries.map((entry) => [
    entry.order_id,
    entry.customer_name ?? "",
    entry.product_name ?? entry.entry_type,
    entry.party_name,
    entry.party_role,
    entry.vertical_id,
    entry.entry_type,
    (entry.amount_fils / 100).toFixed(2),
    formatDateTime(entry[dateField] ?? null),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileLabel}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

type RevenuePeriod = "all" | "last" | "current";

function RevenueView({ accountId, accountName, entries }: { accountId: string; accountName: string; entries: LedgerEntry[] }) {
  const [period, setPeriod] = useState<RevenuePeriod>("all");
  const [query, setQuery] = useState("");
  const [monthlyReport, setMonthlyReport] = useState<{
    accountId: string;
    month: string;
    sourceEntries: LedgerEntry[];
    data: DashboardData["ledger"] | null;
    error: string | null;
  } | null>(null);

  const currentMonth = currentDubaiMonthIndex();
  const targetMonth = period === "current" ? currentMonth : currentMonth - 1;
  const reportingMonth = period === "all"
    ? null
    : `${Math.floor(targetMonth / 12)}-${String(targetMonth % 12 + 1).padStart(2, "0")}`;

  useEffect(() => {
    if (!reportingMonth) return;
    let cancelled = false;
    const reportKey = { accountId, month: reportingMonth, sourceEntries: entries };
    proxyJson<DashboardData["ledger"]>(
      `ledger?view=monthly_commission&month=${reportingMonth}&limit=500`,
      accountId,
      { cache: "no-store" },
    )
      .then((data) => {
        if (data.ledger_basis !== "completed_appointment_month" || data.reporting_month !== reportingMonth) {
          throw new Error("Unexpected monthly report");
        }
        if (!cancelled) setMonthlyReport({ ...reportKey, data, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setMonthlyReport({ ...reportKey, data: null, error: "Could not load monthly revenue. Please refresh to try again." });
        }
      });
    return () => { cancelled = true; };
  }, [accountId, entries, reportingMonth]);

  const report = monthlyReport?.accountId === accountId
    && monthlyReport.month === reportingMonth
    && monthlyReport.sourceEntries === entries
    ? monthlyReport
    : null;
  const loading = Boolean(reportingMonth && !report);
  const error = reportingMonth ? report?.error : null;
  const dateField: LedgerDateField = reportingMonth ? "appointment_at" : "occurred_at";
  const inPeriod = reportingMonth ? report?.data?.items ?? [] : entries;
  const visible = inPeriod.filter((entry) => ledgerMatchesQuery(entry, query, dateField));
  const hasQuery = query.trim().length > 0;
  const periodLabel =
    period === "all" ? "all revenue" : period === "current" ? "the current month" : "last month";

  const periodTotal = reportingMonth
    ? report?.data?.total_amount_fils ?? 0
    : inPeriod.reduce((sum, entry) => sum + (entry.amount_fils || 0), 0);
  const stats = [
    { label: "Total", value: loading || error ? "—" : formatMoney(periodTotal) },
    { label: "Entries", value: loading || error ? "—" : String(inPeriod.length) },
  ];

  return (
    <div className="view-stack">
      <div className="bookings-toolbar">
        <SegmentPicker
          onChange={setPeriod}
          options={[
            { label: "All", value: "all" },
            { label: "Last month", value: "last" },
            { label: "Current month", value: "current" },
          ]}
          value={period}
        />
        <SearchField
          onChange={setQuery}
          placeholder="Search order, product, party, date..."
          value={query}
        />
        <button
          className="icon-action"
          disabled={inPeriod.length === 0}
          onClick={() =>
            exportLedgerCsv(
              inPeriod,
              `revenue-${accountName.replace(/\s+/g, "-").toLowerCase()}-${period === "all" ? "all" : period === "current" ? "current-month" : "last-month"}`,
              dateField,
            )
          }
          type="button"
        >
          <Download size={16} />
          <span>Excel</span>
        </button>
      </div>
      <MetricRow stats={stats} />
      <div className="booking-meta-item">
        {reportingMonth ? "Completed appointments, by appointment date in Dubai." : "Ledger entries, by posting date in Dubai."}
      </div>
      {loading ? (
        <div className="notice" role="status">Loading monthly revenue…</div>
      ) : error ? (
        <div className="notice bad" role="alert">{error}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          body={
            hasQuery
              ? `No entries match “${query.trim()}”. Try a different term.`
              : `${accountName} has no ledger entries for ${periodLabel}.`
          }
          title={
            hasQuery
              ? "No matches"
              : period === "all"
                ? "No revenue yet"
                : period === "current"
                  ? "No revenue this month"
                  : "No revenue last month"
          }
        />
      ) : (
        <div className="booking-list" aria-label="Ledger entries">
          {visible.map((entry) => (
            <LedgerRow dateField={dateField} entry={entry} key={entry.ledger_entry_id} />
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerRow({ entry, dateField }: { entry: LedgerEntry; dateField: LedgerDateField }) {
  const title = entry.customer_name || entry.party_name || entry.order_id;
  const meta = [
    entry.party_name,
    entry.vertical_id?.toUpperCase(),
    entry.booking_id ? `Booking #${entry.booking_id}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="booking-row static">
      <div className="booking-row-copy">
        <div className="booking-row-titleline">
          <span className="booking-row-title">{title}</span>
          <span className="booking-id-pill">{entry.order_id}</span>
        </div>
        <div className="booking-row-subtitle">{entry.product_name || formatStage(entry.entry_type)}</div>
        <div className="booking-row-meta">
          {meta.map((item, index) => (
            <span className="booking-meta-item" key={`${item}-${index}`}>
              {index > 0 ? <span className="booking-meta-dot" aria-hidden="true">·</span> : null}
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="booking-row-side">
        <span className="ledger-amount">{formatMoney(entry.amount_fils)}</span>
        <span className="booking-row-time">{formatDateTime(entry[dateField] ?? null)}</span>
      </div>
    </div>
  );
}

function NursesView({ accountId, data, onChanged }: { accountId: string; data: DashboardData; onChanged: () => Promise<void> }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editNurseId, setEditNurseId] = useState<string | null>(null);
  const nurses = data.nurses.items;
  const accountName = data.context.account.display_name || data.context.dev_selector.account_id;
  const editNurse = nurses.find((nurse) => nurse.nurse_id === editNurseId) ?? null;

  return (
    <div className="view-stack">
      <div className="list-toolbar">
        <div className="list-header">
          <span className="list-header-label">Nurses</span>
          <span className="list-header-count">{nurses.length}</span>
        </div>
        <button className="icon-action" onClick={() => setShowCreate(true)} type="button">
          <Plus size={16} />
          <span>Add nurse</span>
        </button>
      </div>

      {nurses.length === 0 ? (
        <EmptyState
          body={`Add the first nurse for ${accountName} to enable booking assignment.`}
          title="No nurses yet"
        />
      ) : (
        <div className="booking-list" aria-label="Nurses">
          {nurses.map((nurse) => (
            <NurseRow key={nurse.nurse_id} nurse={nurse} onSelect={setEditNurseId} />
          ))}
        </div>
      )}

      {showCreate ? (
        <NurseFormModal accountId={accountId} onClose={() => setShowCreate(false)} onSaved={onChanged} />
      ) : null}
      {editNurse ? (
        <NurseFormModal
          accountId={accountId}
          nurse={editNurse}
          onClose={() => setEditNurseId(null)}
          onSaved={onChanged}
        />
      ) : null}
    </div>
  );
}

function NurseRow({ nurse, onSelect }: { nurse: MarketplaceNurse; onSelect: (id: string) => void }) {
  const subtitle = nurse.phone_number || nurse.nurse_id;
  const meta = [
    nurse.gender ? formatStage(nurse.gender) : null,
    nurse.licence_number ? `Licence ${nurse.licence_number}` : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className="booking-row"
      onClick={() => onSelect(nurse.nurse_id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(nurse.nurse_id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="booking-row-copy">
        <div className="booking-row-titleline">
          <span className="booking-row-title">{nurse.display_name}</span>
        </div>
        <div className="booking-row-subtitle">{subtitle}</div>
        {meta.length ? (
          <div className="booking-row-meta">
            {meta.map((item, index) => (
              <span className="booking-meta-item" key={`${item}-${index}`}>
                {index > 0 ? <span className="booking-meta-dot" aria-hidden="true">·</span> : null}
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="booking-row-side">
        <span className={`status-pill ${statusClass(nurse.status)}`}>{formatStage(nurse.status)}</span>
      </div>
      <ChevronRight aria-hidden="true" className="booking-row-chevron" size={18} strokeWidth={1.6} />
    </div>
  );
}

function localPhone(value: string | null): string {
  return (value ?? "").replace(/\D/g, "").replace(/^971/, "").slice(-9);
}

function NurseFormModal({
  accountId,
  nurse,
  onClose,
  onSaved,
}: {
  accountId: string;
  nurse?: MarketplaceNurse | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(nurse);
  const isInactive = (nurse?.status ?? "").toUpperCase() === "INACTIVE";
  const [displayName, setDisplayName] = useState(nurse?.display_name ?? "");
  const [phone, setPhone] = useState(localPhone(nurse?.phone_number ?? null));
  const [gender, setGender] = useState(nurse?.gender ?? "");
  const [licenceNumber, setLicenceNumber] = useState(nurse?.licence_number ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneSizerRef = useRef<HTMLSpanElement>(null);
  const [phoneWidth, setPhoneWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (phoneSizerRef.current) setPhoneWidth(phoneSizerRef.current.getBoundingClientRect().width);
  }, [phone]);

  const canSave = Boolean(displayName.trim() && phone.trim() && gender.trim() && licenceNumber.trim());

  async function saveNurse(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    setError(null);
    const body = {
      display_name: displayName.trim(),
      gender,
      licence_number: licenceNumber.trim(),
      phone_number: `+971${phone.replace(/\D/g, "").replace(/^0+/, "")}`,
    };
    try {
      if (isEdit && nurse) {
        await proxyJson(`nurses/${nurse.nurse_id}`, accountId, {
          body: JSON.stringify(body),
          method: "PATCH",
        });
      } else {
        await proxyJson("nurses", accountId, { body: JSON.stringify(body), method: "POST" });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyAckError(err));
      setIsSaving(false);
    }
  }

  async function handleActivate() {
    if (!nurse) return;
    setIsActivating(true);
    setError(null);
    try {
      await proxyJson(`nurses/${nurse.nurse_id}`, accountId, {
        body: JSON.stringify({ status: "ACTIVE" }),
        method: "PATCH",
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyAckError(err));
      setIsActivating(false);
    }
  }

  async function handleDelete() {
    if (!nurse) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeleting(true);
    setError(null);
    try {
      await proxyJson(`nurses/${nurse.nurse_id}`, accountId, { method: "DELETE" });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyAckError(err));
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form
        aria-label={isEdit ? "Edit nurse" : "Add nurse"}
        aria-modal="true"
        className="modal-panel"
        onSubmit={saveNurse}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">Roster</div>
            <h2>{isEdit ? "Edit nurse" : "Add nurse"}</h2>
          </div>
          <button aria-label="Close" className="modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modal-form">
          <label>
            Name
            <input onChange={(event) => setDisplayName(event.target.value)} placeholder="Nurse name" required value={displayName} />
          </label>
          <label>
            Phone number
            <span className="phone-input">
              <span className="phone-prefix">+971</span>
              <input
                inputMode="numeric"
                maxLength={9}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="501234567"
                required
                style={phoneWidth ? { width: `${Math.ceil(phoneWidth) + 2}px` } : undefined}
                value={phone}
              />
              <span aria-hidden="true" className="phone-sizer" ref={phoneSizerRef}>
                {phone || "501234567"}
              </span>
            </span>
          </label>
          <label>
            Gender
            <select onChange={(event) => setGender(event.target.value)} required value={gender}>
              <option value="">Select gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </label>
          <label>
            Licence number
            <input onChange={(event) => setLicenceNumber(event.target.value)} placeholder="LIC-12345" required value={licenceNumber} />
          </label>
          {isEdit && isInactive ? (
            <div className="modal-status-row">
              <span className="modal-ack-label">Status</span>
              <span className="status-pill bad">Inactive</span>
            </div>
          ) : null}
          {error ? <div className="modal-action-error">{error}</div> : null}
        </div>

        <div className="modal-actions">
          <button className="modal-cta" disabled={!canSave || isSaving} type="submit">
            {isSaving ? <Loader2 className="spin" size={16} /> : isEdit ? <Check size={16} /> : <Plus size={16} />}
            {isEdit ? "Save changes" : "Add nurse"}
          </button>
          {isEdit && isInactive ? (
            <button className="modal-activate" disabled={isActivating} onClick={handleActivate} type="button">
              {isActivating ? <Loader2 className="spin" size={15} /> : <Check size={15} />}
              Activate nurse
            </button>
          ) : null}
          {isEdit && !isInactive ? (
            <button className="modal-delete" disabled={isDeleting} onClick={handleDelete} type="button">
              {isDeleting ? "Deleting…" : confirmDelete ? "Tap again to confirm delete" : "Delete nurse"}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function minutesToLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${mins.toString().padStart(2, "0")} ${period}`;
}

type AvailabilityCollectorOption = {
  key: string;
  collectorId: string;
  collectorName: string;
  verticalId: string;
  emirate: string | null;
  startMinute: number;
  endMinute: number;
};

function ymdFromUtcDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function todayDubaiYmd() {
  return ymdFromUtcDate(new Date(Date.now() + 4 * 60 * 60 * 1000));
}

function monthParts(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return { year, monthIndex: monthNumber - 1 };
}

function daysInMonth(month: string) {
  const { year, monthIndex } = monthParts(month);
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthRange(month: string) {
  const lastDay = daysInMonth(month);
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shiftMonth(month: string, delta: number) {
  const { year, monthIndex } = monthParts(month);
  const next = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const { year, monthIndex } = monthParts(month);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[monthIndex]} ${year}`;
}

function buildCalendarCells(month: string) {
  const { year, monthIndex } = monthParts(month);
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const totalDays = daysInMonth(month);
  const cells: Array<string | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function calendarCollectorOptions(availabilityRows: AvailabilityRow[], parties: MarketplaceParty[]): AvailabilityCollectorOption[] {
  const options = new Map<string, AvailabilityCollectorOption>();
  for (const row of availabilityRows) {
    if (!row.collector_id) continue;
    const key = `${row.vertical_id}:${row.collector_id}`;
    options.set(key, {
      key,
      collectorId: row.collector_id,
      collectorName: row.collector_name || row.collector_id,
      verticalId: row.vertical_id || "laboratory",
      emirate: row.emirate || null,
      startMinute: row.start_minute || 540,
      endMinute: row.end_minute || 1080,
    });
  }
  for (const party of parties) {
    if (party.role.toUpperCase() !== "COLLECTOR") continue;
    const key = `laboratory:${party.party_id}`;
    if (options.has(key)) continue;
    options.set(key, {
      key,
      collectorId: party.party_id,
      collectorName: party.label || party.name || party.party_id,
      verticalId: "laboratory",
      emirate: null,
      startMinute: 540,
      endMinute: 1080,
    });
  }
  return Array.from(options.values());
}

function verticalDisplayName(verticalId: string) {
  if (verticalId === "iv-drips") return "IV Drips";
  if (verticalId === "laboratory") return "Laboratory";
  return verticalId;
}

function emirateDisplayName(emirate: string | null | undefined) {
  return EMIRATE_OPTIONS.find((option) => option.value === emirate)?.label ?? emirate ?? "All emirates";
}

function resourceModeKey(row: AvailabilityRow) {
  return `${row.vertical_id}:${row.collector_id}:${row.emirate}`;
}

function AvailabilityView({
  accountId,
  availabilityRows,
  nurses,
  parties,
  onChanged,
}: {
  accountId: string;
  availabilityRows: AvailabilityRow[];
  nurses: MarketplaceNurse[];
  parties: MarketplaceParty[];
  onChanged: () => Promise<void>;
}) {
  const [editNurseId, setEditNurseId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [modeSavingKey, setModeSavingKey] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const editNurse = nurses.find((nurse) => nurse.nurse_id === editNurseId) ?? null;
  const resourceRows = useMemo(
    () => availabilityRows.filter((row) => row.collector_id && row.vertical_id && row.emirate),
    [availabilityRows],
  );
  const collectorOptions = useMemo(
    () => calendarCollectorOptions(availabilityRows, parties),
    [availabilityRows, parties],
  );

  async function toggleTimeslotMode(row: AvailabilityRow) {
    const key = resourceModeKey(row);
    const nextMode = row.timeslot_mode === "NURSE" ? "LEGACY" : "NURSE";
    setModeSavingKey(key);
    setModeError(null);
    try {
      await proxyJson("availability/resource-mode", accountId, {
        body: JSON.stringify({
          emirate: row.emirate,
          mode: nextMode,
          party_id: row.collector_id,
          vertical_id: row.vertical_id,
        }),
        method: "PATCH",
      });
      await onChanged();
    } catch (err) {
      setModeError(friendlyAckError(err));
    } finally {
      setModeSavingKey(null);
    }
  }

  return (
    <div className="view-stack">
      <div className="list-toolbar">
        <div className="list-header">
          <span className="list-header-label">Coverage</span>
          <span className="list-header-count">{resourceRows.length}</span>
        </div>
      </div>

      {modeError ? <div className="notice bad notice--inline">{modeError}</div> : null}

      {resourceRows.length === 0 ? (
        <EmptyState title="No active coverage" body="Active Lab or IV coverage is required before slots can be managed." />
      ) : (
        <div className="booking-list" aria-label="Coverage resources">
          {resourceRows.map((row) => (
            <TimeslotResourceRow
              isSaving={modeSavingKey === resourceModeKey(row)}
              key={resourceModeKey(row)}
              onToggle={() => toggleTimeslotMode(row)}
              row={row}
            />
          ))}
        </div>
      )}

      <div className="list-toolbar availability-section-toolbar">
        <div className="list-header">
          <span className="list-header-label">Nurses</span>
          <span className="list-header-count">{nurses.length}</span>
        </div>
        <button className="icon-action" onClick={() => setShowCreate(true)} type="button">
          <Plus size={16} />
          <span>Add nurse</span>
        </button>
      </div>

      {nurses.length === 0 ? (
        <EmptyState title="No nurses yet" body="Add the first nurse, then set availability for each nurse." />
      ) : (
        <div className="booking-list" aria-label="Availability">
          {nurses.map((nurse) => (
            <NurseAvailabilityRow
              key={nurse.nurse_id}
              nurse={nurse}
              onSelect={() => setEditNurseId(nurse.nurse_id)}
            />
          ))}
        </div>
      )}

      {showCreate ? (
        <NurseFormModal accountId={accountId} onClose={() => setShowCreate(false)} onSaved={onChanged} />
      ) : null}
      {editNurse ? (
        <NurseAvailabilityModal
          accountId={accountId}
          nurse={editNurse}
          onClose={() => setEditNurseId(null)}
          onSaved={onChanged}
        />
      ) : null}

      <CollectorAvailabilityCalendar accountId={accountId} collectorOptions={collectorOptions} />
    </div>
  );
}

function TimeslotResourceRow({
  isSaving,
  onToggle,
  row,
}: {
  isSaving: boolean;
  onToggle: () => void;
  row: AvailabilityRow;
}) {
  const mode = row.timeslot_mode === "NURSE" ? "NURSE" : "LEGACY";
  const nextLabel = mode === "NURSE" ? "Use legacy" : "Use nurses";
  const scheduleCount = Number(row.active_nurse_schedule_count ?? 0);
  const timeWindow = `${minutesToLabel(row.start_minute)}-${minutesToLabel(row.end_minute)}`;
  const meta = [
    verticalDisplayName(row.vertical_id),
    emirateDisplayName(row.emirate),
    timeWindow,
    `${scheduleCount} nurse schedule${scheduleCount === 1 ? "" : "s"}`,
  ];

  return (
    <div className="booking-row static resource-row">
      <div className="booking-row-copy">
        <div className="booking-row-titleline">
          <span className="booking-row-title">{row.collector_name || row.collector_id}</span>
          <span className="booking-id-pill">{row.collector_id}</span>
        </div>
        <div className="booking-row-subtitle">
          {mode === "NURSE" ? "Nurse schedules drive public slots" : "Legacy schedule drives public slots"}
        </div>
        <div className="booking-row-meta">
          {meta.map((item, index) => (
            <span className="booking-meta-item" key={`${row.collector_id}-${item}`}>
              {index > 0 ? <span className="booking-meta-dot" aria-hidden="true">·</span> : null}
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="resource-actions">
        <span className={`status-pill ${mode === "NURSE" ? "good" : "neutral"}`}>
          {mode === "NURSE" ? "Nurse mode" : "Legacy mode"}
        </span>
        <button className="mode-toggle-button" disabled={isSaving} onClick={onToggle} type="button">
          {isSaving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function CollectorAvailabilityCalendar({
  accountId,
  collectorOptions,
}: {
  accountId: string;
  collectorOptions: AvailabilityCollectorOption[];
}) {
  const today = todayDubaiYmd();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarState, setCalendarState] = useState<{
    calendar: AvailabilityCalendarResponse | null;
    error: string | null;
    key: string;
  } | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedCollector = collectorOptions.find((option) => option.key === selectedKey) ?? collectorOptions[0] ?? null;
  const { from, to } = monthRange(month);
  const calendarRequestPath = selectedCollector
    ? `availability/collectors/${selectedCollector.collectorId}/calendar?vertical_id=${encodeURIComponent(selectedCollector.verticalId)}&from=${from}&to=${to}`
    : null;
  const calendarRequestKey = selectedCollector ? `${accountId}:${selectedCollector.key}:${month}` : null;
  const calendar = calendarState?.key === calendarRequestKey ? calendarState.calendar : null;
  const calendarError = calendarState?.key === calendarRequestKey ? calendarState.error : null;
  const isLoading = Boolean(calendarRequestKey && calendarState?.key !== calendarRequestKey);
  const activeBlocks = useMemo(
    () => (calendar?.blocks ?? []).filter((block) => block.status.toUpperCase() === "ACTIVE"),
    [calendar],
  );
  const selectedDateBlocks = activeBlocks.filter((block) => block.blockDate === selectedDate);
  const dayBlock = selectedDateBlocks.find((block) => block.kind === "DAY") ?? null;
  const isDayUnavailable = Boolean(dayBlock);
  const timeSlots = useMemo(() => {
    const start = selectedCollector?.startMinute ?? 540;
    const end = selectedCollector?.endMinute ?? 1080;
    const slots: Array<{ start: number; end: number }> = [];
    for (let minute = start; minute < end; minute += 30) {
      slots.push({ start: minute, end: Math.min(minute + 30, end) });
    }
    return slots;
  }, [selectedCollector]);

  useEffect(() => {
    if (!calendarRequestPath || !calendarRequestKey) return;
    let cancelled = false;
    proxyJson<AvailabilityCalendarResponse>(calendarRequestPath, accountId)
      .then((next) => {
        if (!cancelled) setCalendarState({ calendar: next, error: null, key: calendarRequestKey });
      })
      .catch((err) => {
        if (!cancelled) setCalendarState({ calendar: null, error: friendlyAckError(err), key: calendarRequestKey });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, calendarRequestKey, calendarRequestPath]);

  async function reloadCalendar() {
    if (!calendarRequestPath || !calendarRequestKey) return;
    const next = await proxyJson<AvailabilityCalendarResponse>(calendarRequestPath, accountId);
    setCalendarState({ calendar: next, error: null, key: calendarRequestKey });
  }

  async function deleteBlock(blockId: number) {
    await proxyJson(`availability/blocks/${blockId}`, accountId, { method: "DELETE" });
  }

  async function createBlock(body: Record<string, unknown>) {
    if (!selectedCollector) return;
    await proxyJson(`availability/collectors/${selectedCollector.collectorId}/blocks`, accountId, {
      body: JSON.stringify({
        vertical_id: selectedCollector.verticalId,
        ...body,
      }),
      method: "POST",
    });
  }

  async function toggleDay() {
    if (!selectedCollector) return;
    setSavingKey(`day:${selectedDate}`);
    setActionError(null);
    try {
      if (dayBlock) {
        await deleteBlock(dayBlock.blockId);
      } else {
        await createBlock({
          kind: "DAY",
          date: selectedDate,
          reason: "Unavailable",
        });
      }
      await reloadCalendar();
    } catch (err) {
      setActionError(friendlyAckError(err));
    } finally {
      setSavingKey(null);
    }
  }

  async function toggleSlot(startMinute: number, endMinute: number) {
    if (!selectedCollector || isDayUnavailable) return;
    const overlappingBlock = selectedDateBlocks.find((block) => (
      block.kind === "HOURS"
      && block.startMinute !== null
      && block.endMinute !== null
      && block.startMinute < endMinute
      && block.endMinute > startMinute
    ));
    setSavingKey(`slot:${selectedDate}:${startMinute}`);
    setActionError(null);
    try {
      if (overlappingBlock) {
        await deleteBlock(overlappingBlock.blockId);
      } else {
        await createBlock({
          kind: "HOURS",
          date: selectedDate,
          start_minute: startMinute,
          end_minute: endMinute,
          reason: "Unavailable",
        });
      }
      await reloadCalendar();
    } catch (err) {
      setActionError(friendlyAckError(err));
    } finally {
      setSavingKey(null);
    }
  }

  if (!collectorOptions.length) {
    return (
      <div className="calendar-panel">
        <div className="list-header">
          <span className="list-header-label">Calendar blocks</span>
        </div>
        <EmptyState title="No collector calendar" body="Link an active collector before setting day or hour blocks." />
      </div>
    );
  }

  const cells = buildCalendarCells(month);

  return (
    <div className="calendar-panel">
      <div className="list-toolbar calendar-toolbar">
        <div className="list-header">
          <span className="list-header-label">Calendar blocks</span>
          <span className="list-header-count">{activeBlocks.length}</span>
        </div>
        {collectorOptions.length > 1 ? (
          <select
            className="calendar-select"
            onChange={(event) => setSelectedKey(event.target.value)}
            value={selectedCollector?.key ?? ""}
          >
            {collectorOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.collectorName} · {option.verticalId}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {actionError || calendarError ? (
        <div className="notice bad notice--inline">{actionError ?? calendarError}</div>
      ) : null}

      <div className="calendar-split">
        <div>
          <div className="cal-toolbar">
            <button className="cal-nav-button" onClick={() => setMonth((current) => shiftMonth(current, -1))} type="button">
              <ChevronLeft size={17} />
            </button>
            <div className="cal-nav-label">{monthLabel(month)}</div>
            <button className="cal-nav-button" onClick={() => setMonth((current) => shiftMonth(current, 1))} type="button">
              <ChevronRight size={17} />
            </button>
          </div>

          {isLoading ? (
            <div className="cal-loading">
              <Loader2 className="spin" size={22} />
            </div>
          ) : (
            <div className="cal-month">
              <div className="cal-weekdays">
                {NURSE_WEEKDAYS.map((day) => (
                  <span key={day.value}>{day.label}</span>
                ))}
              </div>
              <div className="cal-grid">
                {cells.map((date, index) => {
                  if (!date) return <div className="cal-cell empty" key={`empty-${index}`} />;
                  const blocks = activeBlocks.filter((block) => block.blockDate === date);
                  const hasDayBlock = blocks.some((block) => block.kind === "DAY");
                  const hasHourBlocks = blocks.some((block) => block.kind === "HOURS");
                  const isSelected = date === selectedDate;
                  return (
                    <button
                      className={[
                        "cal-cell",
                        date === today ? "today" : "",
                        hasDayBlock ? "closed" : "",
                        isSelected ? "selected" : "",
                      ].filter(Boolean).join(" ")}
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      type="button"
                    >
                      <span className="cal-date">{Number(date.slice(-2))}</span>
                      {hasDayBlock ? <span className="cal-cell-tag">Off</span> : hasHourBlocks ? <span className="cal-dot" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="cal-day">
          <div className="cal-day-head">
            <div>
              <div className="eyebrow">{selectedCollector?.collectorName}</div>
              <h3>{selectedDate}</h3>
              <p>{selectedCollector?.emirate ?? "All emirates"} · {selectedCollector?.verticalId}</p>
            </div>
          </div>
          <button
            className={isDayUnavailable ? "cal-dayoff-toggle active" : "cal-dayoff-toggle"}
            disabled={savingKey !== null}
            onClick={toggleDay}
            type="button"
          >
            {savingKey === `day:${selectedDate}` ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
            {isDayUnavailable ? "Day marked off" : "Mark full day off"}
          </button>

          <div className={isDayUnavailable ? "cal-slots disabled" : "cal-slots"}>
            {timeSlots.map((slot) => {
              const blocked = selectedDateBlocks.some((block) => (
                block.kind === "HOURS"
                && block.startMinute !== null
                && block.endMinute !== null
                && block.startMinute < slot.end
                && block.endMinute > slot.start
              ));
              const key = `slot:${selectedDate}:${slot.start}`;
              return (
                <button
                  className={blocked ? "cal-slot blocked" : "cal-slot"}
                  disabled={savingKey !== null || isDayUnavailable}
                  key={slot.start}
                  onClick={() => toggleSlot(slot.start, slot.end)}
                  type="button"
                >
                  <span className="cal-slot-time">{minutesToLabel(slot.start)}</span>
                  <span className="cal-slot-state">
                    {savingKey === key ? "Saving" : blocked ? "Off" : "Open"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="cal-hint">Tap a date to close the full day or block individual times.</p>
        </div>
      </div>
    </div>
  );
}

function NurseAvailabilityRow({
  nurse,
  onSelect,
}: {
  nurse: MarketplaceNurse;
  onSelect: () => void;
}) {
  const schedules = nurse.availability ?? [];
  const activeSchedules = schedules.filter((schedule) => (schedule.status ?? "").toUpperCase() === "ACTIVE");
  const meta = activeSchedules.length
    ? activeSchedules.slice(0, 3).map((schedule) => (
        `${schedule.vertical_id.toUpperCase()} · ${schedule.emirate} · ${minutesToLabel(schedule.start_minute)}-${minutesToLabel(schedule.end_minute)}`
      ))
    : ["No active nurse schedule"];
  const subtitle = [nurse.phone_number, nurse.licence_number ? `Licence ${nurse.licence_number}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="booking-row"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="booking-row-copy">
        <div className="booking-row-titleline">
          <span className="booking-row-title">{nurse.display_name}</span>
        </div>
        {subtitle ? <div className="booking-row-subtitle">{subtitle}</div> : null}
        <div className="booking-row-meta">
          {meta.map((item, index) => (
            <span className="booking-meta-item" key={`${item}-${index}`}>
              {index > 0 ? <span className="booking-meta-dot" aria-hidden="true">·</span> : null}
              {item}
            </span>
          ))}
        </div>
      </div>
      <div className="booking-row-side">
        <span className={`status-pill ${activeSchedules.length ? "good" : "neutral"}`}>
          {activeSchedules.length ? `${activeSchedules.length} schedule${activeSchedules.length === 1 ? "" : "s"}` : "Needs schedule"}
        </span>
      </div>
      <ChevronRight aria-hidden="true" className="booking-row-chevron" size={18} strokeWidth={1.6} />
    </div>
  );
}

const NURSE_WEEKDAYS = [
  { label: "Sun", value: "SUNDAY" },
  { label: "Mon", value: "MONDAY" },
  { label: "Tue", value: "TUESDAY" },
  { label: "Wed", value: "WEDNESDAY" },
  { label: "Thu", value: "THURSDAY" },
  { label: "Fri", value: "FRIDAY" },
  { label: "Sat", value: "SATURDAY" },
];

const EMIRATE_OPTIONS = [
  { label: "Abu Dhabi", value: "AUH" },
  { label: "Dubai", value: "DXB" },
  { label: "Al Ain", value: "AL_AIN" },
  { label: "Sharjah", value: "SHJ" },
];

const VERTICAL_OPTIONS = [
  { label: "Laboratory", value: "laboratory" },
  { label: "IV Drips", value: "iv-drips" },
];

const TIME_OPTIONS = Array.from({ length: 49 }, (_, index) => index * 30);

function defaultNurseAvailability(nurse: MarketplaceNurse): NurseAvailability {
  const existing = (nurse.availability ?? []).find((item) => (item.status ?? "").toUpperCase() === "ACTIVE")
    ?? nurse.availability?.[0];
  if (existing) {
    return {
      ...existing,
      breaks: [...(existing.breaks ?? [])],
      off_days: [...(existing.off_days ?? [])],
      service_area_norms: [...(existing.service_area_norms ?? [])],
    };
  }
  return {
    breaks: [],
    busy_buffer_minutes: 60,
    emirate: "AUH",
    end_minute: 1080,
    off_days: [],
    priority: 100,
    service_area_norms: [],
    slot_interval_minutes: 30,
    start_minute: 540,
    status: "ACTIVE",
    vertical_id: "laboratory",
  };
}

function timeOptionLabel(minutes: number) {
  if (minutes === 1440) return "12:00 AM next day";
  return minutesToLabel(minutes);
}

function NurseAvailabilityModal({
  accountId,
  nurse,
  onClose,
  onSaved,
}: {
  accountId: string;
  nurse: MarketplaceNurse;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const initial = defaultNurseAvailability(nurse);
  const [verticalId, setVerticalId] = useState(initial.vertical_id);
  const [emirate, setEmirate] = useState(initial.emirate);
  const [startMinute, setStartMinute] = useState(initial.start_minute);
  const [endMinute, setEndMinute] = useState(initial.end_minute);
  const [busyBuffer, setBusyBuffer] = useState(initial.busy_buffer_minutes);
  const [status, setStatus] = useState(initial.status || "ACTIVE");
  const [offDays, setOffDays] = useState<string[]>(initial.off_days ?? []);
  const [breaks, setBreaks] = useState(initial.breaks ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const breaksAreValid = breaks.every((item) => item.end_minute > item.start_minute);
  const canSave = endMinute > startMinute && breaksAreValid;

  function toggleOffDay(value: string) {
    setOffDays((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function updateBreak(index: number, key: "start_minute" | "end_minute", value: number) {
    setBreaks((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)),
    );
  }

  async function saveAvailability(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    setError(null);
    const body = {
      breaks: breaks.map((item) => ({
        start_minute: item.start_minute,
        end_minute: item.end_minute,
      })),
      busy_buffer_minutes: busyBuffer,
      emirate,
      end_minute: endMinute,
      off_days: offDays,
      priority: initial.priority,
      service_area_norms: initial.service_area_norms ?? [],
      slot_interval_minutes: initial.slot_interval_minutes,
      start_minute: startMinute,
      status,
      vertical_id: verticalId,
    };
    try {
      await proxyJson(`nurses/${nurse.nurse_id}/availability`, accountId, {
        body: JSON.stringify(body),
        method: "PATCH",
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(friendlyAckError(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form
        aria-label={`Availability for ${nurse.display_name}`}
        aria-modal="true"
        className="modal-panel"
        onSubmit={saveAvailability}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">Nurse availability</div>
            <h2>{nurse.display_name}</h2>
            <p>Set the active schedule used when assigning this nurse to bookings.</p>
          </div>
          <button aria-label="Close" className="modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modal-form">
          <label>
            Vertical
            <select onChange={(event) => setVerticalId(event.target.value)} value={verticalId}>
              {VERTICAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Emirate
            <select onChange={(event) => setEmirate(event.target.value)} value={emirate}>
              {EMIRATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Starts
            <select onChange={(event) => setStartMinute(Number(event.target.value))} value={startMinute}>
              {TIME_OPTIONS.slice(0, -1).map((value) => (
                <option key={value} value={value}>{timeOptionLabel(value)}</option>
              ))}
            </select>
          </label>
          <label>
            Ends
            <select onChange={(event) => setEndMinute(Number(event.target.value))} value={endMinute}>
              {TIME_OPTIONS.slice(1).map((value) => (
                <option key={value} value={value}>{timeOptionLabel(value)}</option>
              ))}
            </select>
          </label>
          <label>
            Busy buffer
            <select onChange={(event) => setBusyBuffer(Number(event.target.value))} value={busyBuffer}>
              {[0, 30, 45, 60, 90, 120, 180].map((value) => (
                <option key={value} value={value}>{value} minutes</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>

        <div className="schedule-section">
          <div className="modal-ack-label">Off days</div>
          <div className="weekday-toggle-row">
            {NURSE_WEEKDAYS.map((day) => (
              <button
                className={offDays.includes(day.value) ? "weekday-toggle active" : "weekday-toggle"}
                key={day.value}
                onClick={() => toggleOffDay(day.value)}
                type="button"
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>

        <div className="schedule-section">
          <div className="schedule-section-head">
            <div className="modal-ack-label">Breaks</div>
            <button
              className="inline-action-button"
              onClick={() => setBreaks((current) => [...current, { start_minute: 780, end_minute: 840, status: "ACTIVE" }])}
              type="button"
            >
              <Plus size={14} />
              Add break
            </button>
          </div>
          {breaks.length === 0 ? (
            <div className="schedule-hint">No recurring breaks.</div>
          ) : (
            <div className="break-list">
              {breaks.map((item, index) => (
                <div className="break-row" key={`${item.start_minute}-${item.end_minute}-${index}`}>
                  <select onChange={(event) => updateBreak(index, "start_minute", Number(event.target.value))} value={item.start_minute}>
                    {TIME_OPTIONS.slice(0, -1).map((value) => (
                      <option key={value} value={value}>{timeOptionLabel(value)}</option>
                    ))}
                  </select>
                  <span>to</span>
                  <select onChange={(event) => updateBreak(index, "end_minute", Number(event.target.value))} value={item.end_minute}>
                    {TIME_OPTIONS.slice(1).map((value) => (
                      <option key={value} value={value}>{timeOptionLabel(value)}</option>
                    ))}
                  </select>
                  <button
                    aria-label="Remove break"
                    className="modal-close break-remove"
                    onClick={() => setBreaks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error ? <div className="modal-action-error">{error}</div> : null}
        {!canSave ? <div className="modal-action-error">Check that the end time is after the start time and breaks are valid.</div> : null}

        <div className="modal-actions">
          <button className="modal-cta" disabled={!canSave || isSaving} type="submit">
            {isSaving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
            Save availability
          </button>
        </div>
      </form>
    </div>
  );
}

type WhatsappRecipient = {
  whatsapp_recipient_id: number;
  vertical_id: string;
  party_id: string;
  party_name: string;
  role: string;
  label: string;
  phone_number: string;
  status: string;
  active: boolean;
};

function NotificationsView({ accountId, parties }: { accountId: string; parties: MarketplaceParty[] }) {
  const [recipients, setRecipients] = useState<WhatsappRecipient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await proxyJson<{ items?: WhatsappRecipient[] }>(
        "notifications/whatsapp-recipients",
        accountId,
      );
      setRecipients(data.items ?? []);
    } catch (err) {
      setError(friendlyAckError(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  async function remove(id: number) {
    setRemovingId(id);
    setError(null);
    try {
      await proxyJson(`notifications/whatsapp-recipients/${id}`, accountId, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(friendlyAckError(err));
    } finally {
      setRemovingId(null);
    }
  }

  const verticals = Array.from(new Set(["laboratory", ...recipients.map((r) => r.vertical_id)]));
  const groups = new Map<string, WhatsappRecipient[]>();
  for (const recipient of recipients) {
    const list = groups.get(recipient.party_name) ?? [];
    list.push(recipient);
    groups.set(recipient.party_name, list);
  }

  return (
    <div className="view-stack">
      <div className="list-toolbar">
        <div className="list-header">
          <span className="list-header-label">WhatsApp Notifications</span>
          <span className="list-header-count">{recipients.length}</span>
        </div>
        <button className="icon-action" onClick={() => setShowAdd(true)} type="button">
          <Plus size={16} />
          <span>Add recipient</span>
        </button>
      </div>

      {error ? <div className="notice bad notice--inline">{error}</div> : null}

      {isLoading ? (
        <div className="cal-loading">
          <Loader2 className="spin" size={22} />
        </div>
      ) : recipients.length === 0 ? (
        <EmptyState
          body="Add a WhatsApp recipient to receive booking notifications for this collector or partner."
          title="No recipients yet"
        />
      ) : (
        <div className="recipient-groups">
          {[...groups.entries()].map(([partyName, items]) => (
            <div className="recipient-group" key={partyName}>
              <div className="list-group-label">{partyName}</div>
              <div className="booking-list">
                {items.map((recipient) => (
                  <div className="booking-row static" key={recipient.whatsapp_recipient_id}>
                    <div className="booking-row-copy">
                      <div className="booking-row-titleline">
                        <span className="booking-row-title">{recipient.label}</span>
                      </div>
                      <div className="booking-row-subtitle">{recipient.phone_number}</div>
                      <div className="booking-row-meta">
                        <span className="booking-meta-item">{formatStage(recipient.role)}</span>
                        <span className="booking-meta-item">
                          <span className="booking-meta-dot" aria-hidden="true">·</span>
                          {recipient.vertical_id.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="booking-row-side">
                      <button
                        aria-label={`Remove ${recipient.label}`}
                        className="row-remove"
                        disabled={removingId === recipient.whatsapp_recipient_id}
                        onClick={() => remove(recipient.whatsapp_recipient_id)}
                        type="button"
                      >
                        {removingId === recipient.whatsapp_recipient_id ? (
                          <Loader2 className="spin" size={16} />
                        ) : (
                          <X size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd ? (
        <WhatsappRecipientModal
          accountId={accountId}
          onAdded={load}
          onClose={() => setShowAdd(false)}
          parties={parties}
          verticals={verticals}
        />
      ) : null}
    </div>
  );
}

function WhatsappRecipientModal({
  accountId,
  parties,
  verticals,
  onClose,
  onAdded,
}: {
  accountId: string;
  parties: MarketplaceParty[];
  verticals: string[];
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [partyId, setPartyId] = useState(parties[0]?.party_id ?? "");
  const [vertical, setVertical] = useState(verticals[0] ?? "laboratory");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const party = parties.find((p) => p.party_id === partyId);
  const canSave = Boolean(partyId && vertical && label.trim() && phone.trim());

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!canSave || !party) return;
    setIsSaving(true);
    setError(null);
    try {
      await proxyJson("notifications/whatsapp-recipients", accountId, {
        body: JSON.stringify({
          vertical_id: vertical,
          party_id: party.party_id,
          role: party.role,
          label: label.trim(),
          phone_number: phone.trim(),
        }),
        method: "POST",
      });
      await onAdded();
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      setError(
        raw.includes("whatsapp_recipient_already_exists")
          ? "This number is already a recipient for this party."
          : friendlyAckError(err),
      );
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form
        aria-label="Add WhatsApp recipient"
        aria-modal="true"
        className="modal-panel"
        onSubmit={add}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">WhatsApp</div>
            <h2>Add recipient</h2>
          </div>
          <button aria-label="Close" className="modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modal-form">
          <label>
            Name
            <input onChange={(event) => setLabel(event.target.value)} placeholder="Recipient name" required value={label} />
          </label>
          <label>
            Phone number
            <input onChange={(event) => setPhone(event.target.value)} placeholder="+971501234567" required value={phone} />
          </label>
          <label>
            Party
            <select onChange={(event) => setPartyId(event.target.value)} value={partyId}>
              {parties.map((p) => (
                <option key={p.party_id} value={p.party_id}>
                  {p.name} · {formatStage(p.role)}
                </option>
              ))}
            </select>
          </label>
          {verticals.length > 1 ? (
            <label>
              Vertical
              <select onChange={(event) => setVertical(event.target.value)} value={vertical}>
                {verticals.map((v) => (
                  <option key={v} value={v}>
                    {v.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {error ? <div className="modal-action-error">{error}</div> : null}
        </div>

        <div className="modal-actions">
          <button className="modal-cta" disabled={!canSave || isSaving} type="submit">
            {isSaving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Add recipient
          </button>
        </div>
      </form>
    </div>
  );
}

type TeamMember = {
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  invited_by_email: string | null;
  last_invite_error: string | null;
  invited_at: string | null;
  accepted_at: string | null;
};

function TeamView({ accountId, currentEmail }: { accountId: string; currentEmail: string | null }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await proxyJson<{ items?: TeamMember[] }>("team", accountId);
      setMembers(data.items ?? []);
    } catch (err) {
      setError(friendlyAckError(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  return (
    <div className="view-stack">
      <div className="list-toolbar">
        <div className="list-header">
          <span className="list-header-label">Team</span>
          <span className="list-header-count">{members.length}</span>
        </div>
        <button className="icon-action" onClick={() => setShowInvite(true)} type="button">
          <Plus size={16} />
          <span>Invite user</span>
        </button>
      </div>

      {error ? <div className="notice bad notice--inline">{error}</div> : null}

      {isLoading ? (
        <div className="cal-loading">
          <Loader2 className="spin" size={22} />
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          body="Invite a teammate by email to give them access to this marketplace account."
          title="No team members yet"
        />
      ) : (
        <div className="booking-list" aria-label="Team">
          {members.map((member) => (
            <TeamRow key={member.email} member={member} />
          ))}
        </div>
      )}

      {showInvite ? (
        <TeamInviteModal
          accountId={accountId}
          currentEmail={currentEmail}
          onClose={() => setShowInvite(false)}
          onInvited={load}
        />
      ) : null}
    </div>
  );
}

function TeamRow({ member }: { member: TeamMember }) {
  const name = member.full_name || member.email;
  const meta = [
    formatStage(member.role),
    member.invited_by_email ? `Invited by ${member.invited_by_email}` : null,
    member.accepted_at
      ? `Accepted ${formatDateTime(member.accepted_at)}`
      : member.invited_at
        ? `Invited ${formatDateTime(member.invited_at)}`
        : null,
  ].filter(Boolean) as string[];

  return (
    <div className="booking-row static">
      <div className="booking-row-copy">
        <div className="booking-row-titleline">
          <span className="booking-row-title">{name}</span>
        </div>
        {member.full_name ? <div className="booking-row-subtitle">{member.email}</div> : null}
        <div className="booking-row-meta">
          {meta.map((item, index) => (
            <span className="booking-meta-item" key={`${item}-${index}`}>
              {index > 0 ? <span className="booking-meta-dot" aria-hidden="true">·</span> : null}
              {item}
            </span>
          ))}
        </div>
        {member.last_invite_error ? (
          <div className="team-row-error">{member.last_invite_error}</div>
        ) : null}
      </div>
      <div className="booking-row-side">
        <span className={`status-pill ${statusClass(member.status)}`}>{formatStage(member.status)}</span>
      </div>
    </div>
  );
}

function TeamInviteModal({
  accountId,
  currentEmail,
  onClose,
  onInvited,
}: {
  accountId: string;
  currentEmail: string | null;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("STAFF");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = email.trim().length > 0;

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    setError(null);
    try {
      await proxyJson("team/invite", accountId, {
        body: JSON.stringify({
          email: email.trim(),
          full_name: fullName.trim() || null,
          role,
          invited_by_email: currentEmail || null,
        }),
        method: "POST",
      });
      await onInvited();
      onClose();
    } catch (err) {
      setError(friendlyAckError(err));
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form
        aria-label="Invite user"
        aria-modal="true"
        className="modal-panel"
        onSubmit={invite}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">Team</div>
            <h2>Invite user</h2>
          </div>
          <button aria-label="Close" className="modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modal-form">
          <label>
            Full name
            <input onChange={(event) => setFullName(event.target.value)} placeholder="Teammate name" value={fullName} />
          </label>
          <label>
            Email
            <input
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Role
            <select onChange={(event) => setRole(event.target.value)} value={role}>
              <option value="ADMIN">Admin</option>
              <option value="STAFF">Staff</option>
              <option value="NURSE">Nurse</option>
            </select>
          </label>
          {error ? <div className="modal-action-error">{error}</div> : null}
        </div>

        <div className="modal-actions">
          <button className="modal-cta" disabled={!canSave || isSaving} type="submit">
            {isSaving ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Send invite
          </button>
        </div>
      </form>
    </div>
  );
}

function MetricRow({ stats }: { stats: Array<{ label: string; value: string }> }) {
  return (
    <div
      className="metric-row"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, max-content))` }}
    >
      {stats.map((stat) => (
        <div className="metric" key={stat.label}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
