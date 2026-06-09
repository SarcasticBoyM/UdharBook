"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Activity,
  Camera,
  Clock,
  IndianRupee,
  LocateFixed,
  MapPin,
  Navigation,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  UserPlus,
} from "lucide-react";
import { isSalesRole, isShopAdminRole } from "@/lib/operational-roles";

type CustomerSuggestion = {
  id: string;
  partyName: string;
  contactNumber: string;
  outstandingBalance: number;
  geoAddress?: string | null;
  lastFollowupDate: string | null;
  nextFollowupDate: string | null;
  lastVisitDate: string | null;
};

type Visit = {
  id: string;
  status: "CHECKED_IN" | "COMPLETED" | "CANCELLED";
  checkInAt: string;
  checkOutAt: string | null;
  checkInLat?: number;
  checkInLng?: number;
  accuracy?: number | null;
  verified: boolean;
  outsideWarning: boolean;
  notes: string | null;
  result: string | null;
  outcome?: string | null;
  nextAction?: string | null;
  nextVisitDate?: string | null;
  orderAmount?: number | null;
  orderQuantity?: number | null;
  orderExpectedDelivery?: string | null;
  orderProductCategory?: string | null;
  orderPriority?: string | null;
  paymentMode?: string | null;
  paymentReference?: string | null;
  paymentBankName?: string | null;
  paymentScreenshotUrl?: string | null;
  leadArea?: string | null;
  leadContactPerson?: string | null;
  recoveryAmount: number;
  visitType?: string;
  staff?: { name: string; role: string };
  customer: { id?: string; partyName: string; contactNumber: string; outstandingBalance: number };
  cheques?: {
    id: string;
    chequeNumber: string;
    bankName: string;
    amount: number;
    status: string;
    collectionDateTime: string;
    frontImageUrl: string | null;
  }[];
};

type ChequeCollectionContext = {
  id?: string;
  checkInLat?: number;
  checkInLng?: number;
  accuracy?: number | null;
  customer: { id?: string; partyName: string; contactNumber: string; outstandingBalance: number };
};

type UserRole = "SUPER_ADMIN" | "SHOP_ADMIN" | "SALES_PERSON" | "ACCOUNT_STAFF" | "SALES_PERSON_CUM_ACCOUNTS" | "STAFF" | "FIELD_SALES";

type StaffStatus = {
  id: string;
  name: string;
  role: string;
  status: string;
  latestLocation: {
    createdAt: string;
    accuracy: number | null;
    ageMinutes: number | null;
    googleMapsUrl: string;
  } | null;
  openVisit: {
    id: string;
    checkInAt: string;
    customer: { partyName: string; contactNumber: string };
  } | null;
};

type GpsState = "idle" | "checking" | "active" | "denied" | "timeout" | "unsupported" | "error";
type CustomerSource = "recent" | "pending_recovery" | "today_followup" | "high_amount" | "new_visit";

const commonVisitOutcomes = [
  "Discussion Done",
  "Customer Unavailable",
  "Revisit Required",
  "Follow-up Required",
  "Customer Busy",
  "Payment Promised",
];
const leadVisitOutcomes = [
  "Order Received",
  "Discussion Done",
  "Customer Interested",
  "Revisit Required",
  "Follow-up Required",
  "Customer Busy",
  "Customer Unavailable",
];
const paymentModes = ["Cash", "NEFT / RTGS", "Cheque Collected"];
const visitOutcomeOptions = [
  "Payment Collected",
  "Payment Promised",
  "Order Received",
  "Follow-up Later",
  "Customer Unavailable",
  "Not Reachable",
  "Wrong Number",
  "Product Discussion",
  "Complaint",
  "Site Visit",
  "Delivery Discussion",
  "Partial Payment",
  "Paid Fully",
  "Call Back Requested",
  "Revisit Required",
];
const salesOrderStatuses = [
  "Order Received",
  "Product Discussion",
  "Customer Interested",
  "Follow-up Required",
  "No Order",
  "Revisit Required",
];
const visitTypes = [
  "Recovery Follow-up",
  "Payment Collection",
  "Sales Visit",
  "New Lead Visit",
  "Prospect Visit",
  "Complaint Visit",
  "Stock Check",
  "Relationship Visit",
  "Service Visit",
  "Market Survey",
  "General Visit",
];
const followUpRequiredOutcomes = new Set(["Follow-up Later", "Revisit Required", "Payment Promised", "Customer Unavailable", "Not Reachable", "Call Back Requested"]);
const GPS_SESSION_KEY = "udharbook:gps-active-session";
const customerSourceOptions: { label: string; value: CustomerSource }[] = [
  { label: "Recent Customers", value: "recent" },
  { label: "Pending Recovery", value: "pending_recovery" },
  { label: "Today Follow-ups", value: "today_followup" },
  { label: "High Amount", value: "high_amount" },
  { label: "New Visit", value: "new_visit" },
];

const customerSourceLabels: Record<CustomerSource, string> = {
  recent: "Showing recent customers",
  pending_recovery: "Showing pending recovery customers",
  today_followup: "Showing today's follow-up customers",
  high_amount: "Showing high amount customers",
  new_visit: "Start a new visit without selecting an existing customer",
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function resultOptionsFor(visitType: string) {
  if (visitType === "Sales Visit") return salesOrderStatuses;
  if (visitType === "Payment Collection") return ["Payment Collected", ...commonVisitOutcomes];
  if (visitType === "New Lead Visit" || visitType === "Prospect Visit") return leadVisitOutcomes;
  return commonVisitOutcomes;
}

function isOrderReceived(visitType: string, result: string) {
  return ["Sales Visit", "New Lead Visit", "Prospect Visit", "Payment Collection", "Recovery Follow-up"].includes(visitType) && result === "Order Received";
}

function needsNextFollowup(result: string) {
  return followUpRequiredOutcomes.has(result);
}

function hasVisitOutcome(outcomes: string[], outcome: string) {
  return outcomes.includes(outcome);
}

function combinedOutcomeText(outcomes: string[], fallback: string) {
  return outcomes.length ? outcomes.join(", ") : fallback;
}

function isOrderOutcome(visitType: string, result: string, outcomes: string[]) {
  return isOrderReceived(visitType, result) || hasVisitOutcome(outcomes, "Order Received");
}

function isPaymentOutcome(visitType: string, outcomes: string[]) {
  void visitType;
  return outcomes.some((outcome) => ["Payment Collected", "Partial Payment", "Paid Fully"].includes(outcome));
}

function needsNextFollowupOutcome(result: string, outcomes: string[]) {
  return needsNextFollowup(result) || outcomes.some((outcome) => followUpRequiredOutcomes.has(outcome));
}

export default function FieldStaffPage() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [tracking, setTracking] = useState(false);
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [gpsState, setGpsState] = useState<GpsState>("idle");
  const [gpsError, setGpsError] = useState("");
  const [visitSaving, setVisitSaving] = useState(false);
  const [lastGpsSyncAt, setLastGpsSyncAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [activeCustomerSource, setActiveCustomerSource] = useState<CustomerSource>("recent");
  const [searching, setSearching] = useState(false);
  const [customers, setCustomers] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadContactPerson, setLeadContactPerson] = useState("");
  const [leadMobile, setLeadMobile] = useState("");
  const [leadAddress, setLeadAddress] = useState("");
  const [leadArea, setLeadArea] = useState("");
  const [visitType, setVisitType] = useState("Sales Visit");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [staffStatuses, setStaffStatuses] = useState<StaffStatus[]>([]);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState(resultOptionsFor("Sales Visit")[0]);
  const [visitOutcomes, setVisitOutcomes] = useState<string[]>([]);
  const [nextAction, setNextAction] = useState("");
  const [orderExpectedDelivery, setOrderExpectedDelivery] = useState("");
  const [orderProductCategory, setOrderProductCategory] = useState("");
  const [orderPriority, setOrderPriority] = useState("Normal");
  const [paymentMode, setPaymentMode] = useState(paymentModes[0]);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentBankName, setPaymentBankName] = useState("");
  const [paymentScreenshotUrl, setPaymentScreenshotUrl] = useState("");
  const [recoveryAmount, setRecoveryAmount] = useState("");
  const [nextFollowupDate, setNextFollowupDate] = useState("");
  const [showChequeFlow, setShowChequeFlow] = useState(false);
  const [chequeVisit, setChequeVisit] = useState<Visit | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const isFieldWorker = isSalesRole(role ?? "");
  const isAdmin = isShopAdminRole(role ?? "");
  const canSaveVisit = Boolean(isFieldWorker && (selectedCustomer || leadName.trim()) && visitOutcomes.length > 0 && gpsState !== "checking" && !visitSaving);
  const showNotFound = search.trim().length > 0 && !searching && customers.length === 0 && !selectedCustomer;
  const chequeCollectionContext: ChequeCollectionContext | null = chequeVisit
    ? chequeVisit
    : selectedCustomer
      ? { customer: selectedCustomer }
      : leadName.trim()
        ? { customer: { partyName: leadName.trim(), contactNumber: leadMobile, outstandingBalance: 0 } }
        : null;
  const summary = useMemo(
    () => ({
      visits: visits.length,
      completed: visits.filter((visit) => visit.status === "COMPLETED").length,
      ordersBooked: visits.filter((visit) => (visit.outcome ?? visit.result ?? "").includes("Order Received") || isOrderReceived(visit.visitType ?? "", visit.outcome ?? visit.result ?? "") || Boolean(visit.orderQuantity ?? visit.orderAmount)).length,
      orderValue: visits.reduce((sum, visit) => sum + (visit.orderAmount ?? 0), 0),
      recovered: visits.reduce((sum, visit) => sum + visit.recoveryAmount, 0),
      newLeads: visits.filter((visit) => visit.visitType === "New Lead Visit" || visit.visitType === "New Lead").length,
      productive: visits.filter((visit) => visit.status === "COMPLETED" && !["Customer unavailable", "No response"].includes(visit.outcome ?? visit.result ?? "")).length,
      pendingFollowups: visits.filter((visit) => visit.nextVisitDate).length,
    }),
    [visits],
  );

  const sendLocation = useCallback(async (position: GeolocationPosition, status = "ACTIVE") => {
    console.log("[Field GPS] coordinates received", {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      status,
    });
    const res = await fetch("/api/field-staff/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        status,
        source: "watchPosition",
      }),
    });
    if (!res.ok) throw new Error("Location save failed");
    console.log("[Field GPS] coordinates saved", {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      status,
    });
    setLastGpsSyncAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    const options = resultOptionsFor(visitType);
    if (!options.includes(result)) {
      setResult(options[0]);
    }
  }, [result, visitType]);

  useEffect(() => {
    setShowChequeFlow(Boolean(chequeVisit) || (isPaymentOutcome(visitType, visitOutcomes) && paymentMode === "Cheque Collected"));
  }, [chequeVisit, paymentMode, visitOutcomes, visitType]);

  const stopGpsWatcher = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const startGpsWatcher = useCallback((source = "manual") => {
    console.log("[Field GPS] start watchPosition", source);
    if (!navigator.geolocation) {
      setGpsState("unsupported");
      setGpsError("Geolocation not supported");
      return;
    }
    if (!window.isSecureContext) {
      setGpsState("error");
      setGpsError("GPS works only on HTTPS. Open https://app.qrvcard.in");
      return;
    }
    if (watchIdRef.current !== null) return;

    setGpsState("checking");
    setGpsError("");
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        console.log("[Field GPS] watchPosition success");
        setLocation(position);
        setGpsState("active");
        setGpsError("");
        await sendLocation(position, "ACTIVE").catch((error) => {
          console.error("[Field GPS] background sync failed", error);
        });
      },
      (error) => {
        console.error("[Field GPS] watchPosition error", error);
        if (error.code === 1) {
          stopGpsWatcher();
          window.localStorage.removeItem(GPS_SESSION_KEY);
          setTracking(false);
          setGpsState("denied");
          setGpsError("Location permission blocked. Chrome -> lock icon -> Site settings -> Location -> Allow.");
          return;
        }
        if (!navigator.onLine) {
          console.warn("[Field GPS] device offline; watcher will retry when online");
        }
        setGpsState(error.code === 3 ? "timeout" : "error");
        if (retryTimerRef.current === null) {
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            if (window.localStorage.getItem(GPS_SESSION_KEY) === "true") {
              stopGpsWatcher();
              startGpsWatcher("silent-retry");
            }
          }, 30000);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 30000,
      },
    );
  }, [sendLocation, stopGpsWatcher]);

  const loadVisits = useCallback(async () => {
    const res = await fetch("/api/field-staff/visits");
    const data = await res.json();
    if (data.success) {
      setVisits(data.visits);
      console.info("[Field Visit] visits refreshed", { visits: data.visits?.length ?? 0 });
    }
  }, []);

  const loadStaffStatuses = useCallback(async () => {
    if (!isAdmin) return;
    const res = await fetch("/api/field-staff/locations");
    const data = await res.json().catch(() => ({}));
    if (data.success) setStaffStatuses(data.staff ?? []);
  }, [isAdmin]);

  const runDirectGpsRequest = useCallback((options?: {
    status?: string;
    onSuccess?: (position: GeolocationPosition) => void | Promise<void>;
  }) => {
    console.log("[Field GPS] click triggered");
    console.log("[Field GPS] geolocation supported", Boolean(navigator.geolocation));
    console.log("[Field GPS] PWA mode", window.matchMedia?.("(display-mode: standalone)").matches);
    console.log("[Field GPS] secure context", window.isSecureContext, window.location.href);

    if (!navigator.geolocation) {
      setGpsState("unsupported");
      setGpsError("Geolocation not supported");
      alert("Geolocation not supported");
      return;
    }
    if (!window.isSecureContext) {
      setGpsState("error");
      setGpsError("GPS works only on HTTPS. Open https://app.qrvcard.in");
      return;
    }

    setGpsState("checking");
    setGpsError("");
    setMessage("");
    console.log("[Field GPS] request started");

    const timeoutId = window.setTimeout(() => {
      console.warn("[Field GPS] GPS timeout");
      setGpsState("timeout");
      setGpsError("GPS request timed out. Keep phone location ON and tap Force Request GPS.");
    }, 15000);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        window.clearTimeout(timeoutId);
        console.log("[Field GPS] GPS success", position);
        console.log("[Field GPS] GPS granted");
        setLocation(position);
        setGpsState("active");
        setGpsError("");
        setLastGpsSyncAt(new Date().toISOString());
        await sendLocation(position, options?.status ?? "ACTIVE").catch(() => setMessage("GPS captured, but could not sync location."));
        await options?.onSuccess?.(position);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        console.error("[Field GPS] GPS error", error);
        if (error.code === 1) {
          setGpsState("denied");
          setGpsError("Location permission blocked. Chrome -> lock icon -> Site settings -> Location -> Allow.");
        } else if (error.code === 3) {
          setGpsState("timeout");
          setGpsError("GPS timeout. Turn on phone location, move near a window, then retry.");
        } else {
          setGpsState("error");
          setGpsError(error.message || "Could not capture GPS location.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [sendLocation]);

  const ensureGpsSession = useCallback(async (source = "manual") => {
    if (!navigator.geolocation) {
      setGpsState("unsupported");
      setGpsError("Geolocation not supported");
      return;
    }
    if (navigator.permissions?.query) {
      try {
        const permission = await navigator.permissions.query({ name: "geolocation" as PermissionName });
        console.log("[Field GPS] permission state", permission.state);
        if (permission.state === "granted") {
          window.localStorage.setItem(GPS_SESSION_KEY, "true");
          startGpsWatcher(source);
          return;
        }
        if (permission.state === "denied") {
          setGpsState("denied");
          setGpsError("Location permission blocked. Chrome -> lock icon -> Site settings -> Location -> Allow.");
          return;
        }
      } catch (error) {
        console.warn("[Field GPS] permission query failed", error);
      }
    }
    runDirectGpsRequest({
      status: "ACTIVE",
      onSuccess: () => {
        window.localStorage.setItem(GPS_SESSION_KEY, "true");
        startGpsWatcher(source);
      },
    });
  }, [runDirectGpsRequest, startGpsWatcher]);

  const requestGPS = () => ensureGpsSession("gps-button");
  const forceRequestGPS = () => runDirectGpsRequest({
    status: "ACTIVE",
    onSuccess: () => {
      window.localStorage.setItem(GPS_SESSION_KEY, "true");
      startGpsWatcher("force-button");
    },
  });

  function openLocationSettings() {
    setMessage("Chrome Android: lock icon -> Site settings -> Location -> Allow. Installed PWA: long-press app icon -> App info -> Permissions -> Location -> Allow.");
  }

  async function startTracking() {
    if (!isFieldWorker) return;
    setTracking(true);
    window.localStorage.setItem(GPS_SESSION_KEY, "true");
    runDirectGpsRequest({
      status: "ACTIVE",
      onSuccess: () => startGpsWatcher("start-day"),
    });
    await fetch("/api/field-staff/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "START" }),
    });
  }

  async function stopTracking() {
    if (!isFieldWorker) return;
    setTracking(false);
    window.localStorage.removeItem(GPS_SESSION_KEY);
    stopGpsWatcher();
    await fetch("/api/field-staff/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "STOP" }),
    });
    setMessage("Field tracking stopped.");
  }

  function handlePaymentScreenshot(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPaymentScreenshotUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  const selectCustomerForVisit = useCallback((customer: CustomerSuggestion) => {
    setSelectedCustomer(customer);
    setSearch(customer.partyName);
    setCustomers([]);
    setSearching(false);
    setShowNewVisit(false);
    setChequeVisit(null);
  }, []);

  function toggleVisitOutcome(outcome: string) {
    setVisitOutcomes((current) => (current.includes(outcome) ? current.filter((item) => item !== outcome) : [...current, outcome]));
    setResult(outcome);
  }

  async function saveVisitAtLocation(position: GeolocationPosition, options: { resetForm?: boolean; successMessage?: string } = {}): Promise<Visit | null> {
    const shouldResetForm = options.resetForm ?? true;
    if (!isFieldWorker) return null;
    if (!selectedCustomer && !leadName.trim()) return null;
    const outcomeText = combinedOutcomeText(visitOutcomes, result);
    const hasOrder = isOrderOutcome(visitType, result, visitOutcomes);
    const hasPayment = isPaymentOutcome(visitType, visitOutcomes);
    const hasFollowup = needsNextFollowupOutcome(result, visitOutcomes);
    setVisitSaving(true);
    try {
      const res = await fetch("/api/field-staff/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer?.id,
          customerName: selectedCustomer?.partyName ?? leadName.trim(),
          mobileNumber: selectedCustomer?.contactNumber ?? leadMobile,
          address: leadAddress || undefined,
          visitType,
          outcome: outcomeText,
          visitOutcomes: visitOutcomes.length ? visitOutcomes : [result],
          nextAction: hasOrder ? undefined : nextAction || undefined,
          nextVisitDate: hasFollowup && nextFollowupDate ? new Date(nextFollowupDate).toISOString() : undefined,
          orderExpectedDelivery: hasOrder && orderExpectedDelivery ? new Date(orderExpectedDelivery).toISOString() : undefined,
          orderProductCategory: hasOrder ? orderProductCategory || undefined : undefined,
          orderPriority: hasOrder ? orderPriority || undefined : undefined,
          paymentMode: hasPayment ? paymentMode : undefined,
          paymentReference: hasPayment && paymentMode === "NEFT / RTGS" ? paymentReference || undefined : undefined,
          paymentBankName: hasPayment && paymentMode === "NEFT / RTGS" ? paymentBankName || undefined : undefined,
          paymentScreenshotUrl: hasPayment && paymentMode === "NEFT / RTGS" ? paymentScreenshotUrl || undefined : undefined,
          leadArea: leadArea || undefined,
          leadContactPerson: leadContactPerson || undefined,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          notes,
          recoveryAmount: (hasPayment && paymentMode !== "Cheque Collected") || visitType === "Recovery Follow-up" ? Number(recoveryAmount || 0) : 0,
          nextFollowupDate: hasFollowup && nextFollowupDate ? new Date(nextFollowupDate).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.error ?? "Could not save visit.");
        return null;
      }
      const needsCheque = hasPayment && paymentMode === "Cheque Collected";
      setChequeVisit(needsCheque ? data.visit : null);
      setShowChequeFlow(needsCheque);
      if (shouldResetForm) {
        setSelectedCustomer(null);
        setSearch("");
        setCustomers([]);
        setShowNewVisit(false);
        setLeadName("");
        setLeadContactPerson("");
        setLeadMobile("");
        setLeadAddress("");
        setLeadArea("");
        setNotes("");
        setVisitOutcomes([]);
        setRecoveryAmount("");
        setNextFollowupDate("");
        setNextAction("");
        setOrderExpectedDelivery("");
        setOrderProductCategory("");
        setOrderPriority("Normal");
        setPaymentMode(paymentModes[0]);
        setPaymentReference("");
        setPaymentBankName("");
        setPaymentScreenshotUrl("");
      }
      setMessage(options.successMessage ?? (needsCheque ? "Visit saved. Add cheque details below." : "Visit saved successfully."));
      await loadVisits();
      return data.visit as Visit;
    } finally {
      setVisitSaving(false);
    }
  }

  function saveVisit() {
    if (!isFieldWorker) return;
    if (!canSaveVisit) return;
    runDirectGpsRequest({ status: "ACTIVE", onSuccess: async (position) => { await saveVisitAtLocation(position); } });
  }

  function startNewVisit(prefill = search) {
    if (!isFieldWorker) return;
    setShowNewVisit(true);
    setSelectedCustomer(null);
    setLeadName(prefill.trim());
    setVisitType("New Lead Visit");
    setResult(resultOptionsFor("New Lead Visit")[0]);
    setVisitOutcomes([]);
  }

  function applyChip(source: CustomerSource) {
    if (!isFieldWorker) return;
    setActiveCustomerSource(source);
    setSelectedCustomer(null);
    if (source === "new_visit") {
      setSearch("");
      setCustomers([]);
      startNewVisit("");
      return;
    }
    setShowNewVisit(false);
  }

  function gpsBadge() {
    if (gpsState === "active") return "bg-emerald-100 text-emerald-800 border-emerald-200";
    if (gpsState === "denied" || gpsState === "error" || gpsState === "unsupported") return "bg-red-100 text-red-800 border-red-200";
    if (gpsState === "checking") return "bg-blue-100 text-blue-800 border-blue-200";
    if (gpsState === "timeout") return "bg-amber-100 text-amber-800 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  }

  function gpsLabel() {
    if (gpsState === "active") return "GPS active";
    if (gpsState === "checking") return "Requesting GPS";
    if (gpsState === "denied") return "GPS blocked";
    if (gpsState === "timeout") return "GPS paused";
    if (gpsState === "unsupported") return "No GPS support";
    if (gpsState === "error") return "GPS error";
    return "GPS not active";
  }

  function lastSyncLabel() {
    if (!lastGpsSyncAt) return "Last sync: not yet";
    const minutes = Math.max(0, Math.round((Date.now() - new Date(lastGpsSyncAt).getTime()) / 60000));
    if (minutes < 1) return "Last sync: just now";
    return `Last sync: ${minutes} min ago`;
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setRole((data?.user?.role as UserRole | undefined) ?? null))
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    if (!role) return;
    loadVisits();
    void loadStaffStatuses();
  }, [loadStaffStatuses, loadVisits, role]);

  useEffect(() => {
    if (!isFieldWorker) return;
    if (window.localStorage.getItem(GPS_SESSION_KEY) === "true") {
      setTracking(true);
      ensureGpsSession("restore");
    }

    const restart = () => {
      if (window.localStorage.getItem(GPS_SESSION_KEY) !== "true") return;
      if (document.visibilityState === "visible" && navigator.onLine) {
        startGpsWatcher("resume-or-reconnect");
      }
    };

    window.addEventListener("online", restart);
    window.addEventListener("focus", restart);
    document.addEventListener("visibilitychange", restart);
    return () => {
      window.removeEventListener("online", restart);
      window.removeEventListener("focus", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [ensureGpsSession, isFieldWorker, startGpsWatcher]);

  useEffect(() => {
    if (!isFieldWorker) {
      setCustomers([]);
      setSearching(false);
      return;
    }
    const query = search.trim();
    if (selectedCustomer && query === selectedCustomer.partyName) {
      setCustomers([]);
      setSearching(false);
      return;
    }
    let controller: AbortController | null = null;
    const timer = window.setTimeout(async () => {
      const shouldLoadSource = activeCustomerSource !== "new_visit";
      if (query.length < 1 && !shouldLoadSource) {
        setCustomers([]);
        setSearching(false);
        return;
      }
      controller = new AbortController();
      setSearching(true);
      const params = new URLSearchParams({
        q: query,
        source: activeCustomerSource,
        limit: "10",
      });
      try {
        const res = await fetch(`/api/customers/search?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        setCustomers(data.customers ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setCustomers([]);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [activeCustomerSource, isFieldWorker, search, selectedCustomer]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-28">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Field Operations</p>
          <h1 className="text-2xl font-bold md:text-3xl">Field Operations</h1>
          <p className="text-sm text-slate-500">
            {isFieldWorker ? "Search customer or start a new visit instantly." : "Monitor live staff status, active visits, GPS, and today timeline."}
          </p>
          {isFieldWorker && (
            <>
              <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${gpsBadge()}`}>
                {gpsState === "checking" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
                {gpsLabel()}
                {location && <span className="font-normal">+/-{Math.round(location.coords.accuracy)}m</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">{tracking ? lastSyncLabel() : "Start Day to keep GPS active."}</p>
            </>
          )}
        </div>
        {isFieldWorker ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={tracking ? stopTracking : startTracking} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white md:flex-none">
              {tracking ? <PauseCircle className="h-5 w-5" /> : <Navigation className="h-5 w-5" />}
              {tracking ? "Stop Day" : "Start Day"}
            </button>
            <button type="button" onClick={requestGPS} disabled={gpsState === "checking"} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-60">
              {gpsState === "checking" ? <RefreshCw className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
              GPS
            </button>
          </div>
        ) : isAdmin ? (
          <button type="button" onClick={loadStaffStatuses} className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold">
            <RefreshCw className="h-5 w-5" />
            Refresh
          </button>
        ) : null}
      </div>

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
      {isFieldWorker && gpsError && (
        <div className={`rounded-lg border p-3 text-sm ${gpsState === "denied" || gpsState === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          <p className="font-semibold">{gpsError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={forceRequestGPS} className="flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white"><RefreshCw className="h-4 w-4" /> Force Request GPS</button>
            {(gpsState === "denied" || gpsState === "error") && <button type="button" onClick={openLocationSettings} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold"><Settings className="h-4 w-4" /> Open Settings</button>}
          </div>
        </div>
      )}

      {isFieldWorker && tracking && (
        <div className={`fixed bottom-20 right-3 z-40 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg lg:bottom-4 ${gpsBadge()}`}>
          <span className="mr-1">{gpsState === "active" ? "GPS Active" : gpsLabel()}</span>
          <span className="font-normal">{lastSyncLabel().replace("Last sync: ", "")}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visits today" value={summary.visits} />
        <Stat label="Completed" value={summary.completed} />
        <Stat label="Orders booked" value={summary.ordersBooked} />
        <Stat label="Order value" value={money(summary.orderValue)} />
        <Stat label="Recovered" value={money(summary.recovered)} />
        <Stat label="New leads" value={summary.newLeads} />
        <Stat label="Productive visits" value={summary.productive} />
        <Stat label="Pending follow-ups" value={summary.pendingFollowups} />
      </div>

      {isAdmin && <StaffStatusPanel staff={staffStatuses} />}

      {isFieldWorker ? (
        <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Add Visit</h2>
              <p className="text-sm text-slate-500">Select outcomes and save. No checkout needed.</p>
            </div>
            <button type="button" onClick={() => startNewVisit("")} className="flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> New Visit
            </button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {customerSourceOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => applyChip(option.value)}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${
                  activeCustomerSource === option.value
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{customerSourceLabels[activeCustomerSource]}</p>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedCustomer(null);
                setChequeVisit(null);
                if (activeCustomerSource === "new_visit") setActiveCustomerSource("recent");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && customers[0]) {
                  event.preventDefault();
                  selectCustomerForVisit(customers[0]);
                }
                if (event.key === "Escape") {
                  setCustomers([]);
                  setSearching(false);
                }
              }}
              placeholder="Search customer, business, or mobile"
              className="min-h-12 w-full rounded-lg border py-3 pl-10 pr-3 dark:border-slate-700 dark:bg-slate-900"
            />
            {(customers.length > 0 || searching) && (
              <div className="absolute z-20 mt-2 max-h-96 w-full overflow-auto rounded-lg border bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {searching && <p className="p-4 text-sm text-slate-500">Searching...</p>}
                {customers.map((customer) => (
                  <button key={customer.id} type="button" onClick={() => selectCustomerForVisit(customer)} className="w-full border-b px-4 py-3 text-left last:border-b-0 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{customer.partyName}</p>
                        <p className="truncate text-xs text-slate-500">
                          {customer.contactNumber}
                          {customer.geoAddress ? ` | ${customer.geoAddress}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-bold">{money(customer.outstandingBalance)}</p>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
                      <span>Last follow-up: {formatDateTime(customer.lastFollowupDate)}</span>
                      <span>Next: {formatDateTime(customer.nextFollowupDate)}</span>
                      <span>Last visit: {formatDateTime(customer.lastVisitDate)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedCustomer && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-bold">{selectedCustomer.partyName}</p>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                <span>Balance: {money(selectedCustomer.outstandingBalance)}</span>
                <span>Last follow-up: {formatDateTime(selectedCustomer.lastFollowupDate)}</span>
                <span>Next follow-up: {formatDateTime(selectedCustomer.nextFollowupDate)}</span>
                <span>Last visit: {formatDateTime(selectedCustomer.lastVisitDate)}</span>
              </div>
            </div>
          )}

          {selectedCustomer && !showNewVisit && (
            <VisitDetailFields
              visitType={visitType}
              result={result}
              visitOutcomes={visitOutcomes}
              nextAction={nextAction}
              recoveryAmount={recoveryAmount}
              nextFollowupDate={nextFollowupDate}
              orderExpectedDelivery={orderExpectedDelivery}
              orderProductCategory={orderProductCategory}
              orderPriority={orderPriority}
              paymentMode={paymentMode}
              paymentReference={paymentReference}
              paymentBankName={paymentBankName}
              paymentScreenshotUrl={paymentScreenshotUrl}
              onVisitType={setVisitType}
              onToggleOutcome={toggleVisitOutcome}
              onNextAction={setNextAction}
              onRecovery={setRecoveryAmount}
              onNextFollowup={setNextFollowupDate}
              onOrderExpectedDelivery={setOrderExpectedDelivery}
              onOrderProductCategory={setOrderProductCategory}
              onOrderPriority={setOrderPriority}
              onPaymentMode={setPaymentMode}
              onPaymentReference={setPaymentReference}
              onPaymentBankName={setPaymentBankName}
              onPaymentScreenshot={handlePaymentScreenshot}
            />
          )}

          {showNotFound && (
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-center">
              <p className="font-semibold">Customer not found</p>
              <button type="button" onClick={() => startNewVisit(search)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">
                <UserPlus className="h-4 w-4" /> Create New Customer
              </button>
            </div>
          )}

          {showNewVisit && (
            <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-900 dark:bg-brand-950/20">
              <h3 className="font-bold">New Visit</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="Customer name *" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <input value={leadContactPerson} onChange={(e) => setLeadContactPerson(e.target.value)} placeholder="Contact person" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <input value={leadMobile} onChange={(e) => setLeadMobile(e.target.value)} inputMode="tel" placeholder="Mobile number" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <input value={leadArea} onChange={(e) => setLeadArea(e.target.value)} placeholder="Area / market" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <input value={leadAddress} onChange={(e) => setLeadAddress(e.target.value)} placeholder="Address/location" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                <select value={visitType} onChange={(e) => setVisitType(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
                  {visitTypes.map((type) => <option key={type}>{type}</option>)}
                </select>
                <VisitOutcomeChips outcomes={visitOutcomes} onToggle={toggleVisitOutcome} />
                {!isOrderOutcome(visitType, result, visitOutcomes) && (
                  <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Next action" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                )}
                {isOrderOutcome(visitType, result, visitOutcomes) && (
                  <>
                    <textarea value={orderProductCategory} onChange={(e) => setOrderProductCategory(e.target.value)} placeholder="Order Details" className="min-h-28 rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900 md:col-span-2" />
                    <input value={orderExpectedDelivery} onChange={(e) => setOrderExpectedDelivery(e.target.value)} type="date" aria-label="Preferred Delivery Date" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                    <select value={orderPriority} onChange={(e) => setOrderPriority(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
                      <option>Normal</option>
                      <option>Urgent</option>
                      <option>High</option>
                    </select>
                  </>
                )}
                {isPaymentOutcome(visitType, visitOutcomes) && (
                  <PaymentFields
                    visitType={visitType}
                    paymentMode={paymentMode}
                    paymentReference={paymentReference}
                    paymentBankName={paymentBankName}
                    paymentScreenshotUrl={paymentScreenshotUrl}
                    recoveryAmount={recoveryAmount}
                    onPaymentMode={setPaymentMode}
                    onPaymentReference={setPaymentReference}
                    onPaymentBankName={setPaymentBankName}
                    onPaymentScreenshot={handlePaymentScreenshot}
                    onRecovery={setRecoveryAmount}
                  />
                )}
                {needsNextFollowupOutcome(result, visitOutcomes) && (
                  <input value={nextFollowupDate} onChange={(e) => setNextFollowupDate(e.target.value)} type="datetime-local" aria-label="Next Follow-up Date" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
                )}
              </div>
            </div>
          )}

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Visit notes" className="mt-3 min-h-20 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
          {showChequeFlow && chequeCollectionContext && (
            <VisitChequeCollection
              visit={chequeCollectionContext}
              location={location}
              onSaved={async () => {
                setMessage("Cheque saved to Recovery Desk.");
                setChequeVisit(null);
                setShowChequeFlow(false);
                await loadVisits();
              }}
            />
          )}
          <div className="sticky bottom-3 z-10 mt-3">
            <button type="button" onClick={saveVisit} disabled={!canSaveVisit} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-semibold text-white shadow-lg disabled:opacity-50">
              <MapPin className="h-5 w-5" /> {visitSaving || gpsState === "checking" ? "Saving Visit..." : "Save Visit"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5" /> Today Timeline</h2>
        <div className="mt-4 space-y-3">
          {visits.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">No visits recorded today.</p>}
          {visits.map((visit) => (
            <div key={visit.id} className="rounded-lg border p-3 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{visit.customer.partyName}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(visit.checkInAt)} · {visit.staff?.name ?? "Staff"}</p>
                  <p className="mt-1 text-sm line-clamp-2">{visit.outcome ?? visit.result ?? visit.notes ?? "Visit recorded"}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800">{visit.status}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {visit.verified ? "GPS captured" : "GPS saved"}</span>
                <span>{visit.visitType ?? "Visit"}</span>
                {visit.orderQuantity ? <span>Qty {visit.orderQuantity}</span> : visit.orderAmount ? <span>Order {money(visit.orderAmount)}</span> : null}
                {visit.recoveryAmount > 0 && <span className="flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" /> {money(visit.recoveryAmount)}</span>}
                {visit.nextAction && <span>Next: {visit.nextAction}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function VisitDetailFields({
  visitType,
  result,
  visitOutcomes,
  nextAction,
  recoveryAmount,
  nextFollowupDate,
  orderExpectedDelivery,
  orderProductCategory,
  orderPriority,
  paymentMode,
  paymentReference,
  paymentBankName,
  paymentScreenshotUrl,
  onVisitType,
  onToggleOutcome,
  onNextAction,
  onRecovery,
  onNextFollowup,
  onOrderExpectedDelivery,
  onOrderProductCategory,
  onOrderPriority,
  onPaymentMode,
  onPaymentReference,
  onPaymentBankName,
  onPaymentScreenshot,
}: {
  visitType: string;
  result: string;
  visitOutcomes: string[];
  nextAction: string;
  recoveryAmount: string;
  nextFollowupDate: string;
  orderExpectedDelivery: string;
  orderProductCategory: string;
  orderPriority: string;
  paymentMode: string;
  paymentReference: string;
  paymentBankName: string;
  paymentScreenshotUrl: string;
  onVisitType: (value: string) => void;
  onToggleOutcome: (value: string) => void;
  onNextAction: (value: string) => void;
  onRecovery: (value: string) => void;
  onNextFollowup: (value: string) => void;
  onOrderExpectedDelivery: (value: string) => void;
  onOrderProductCategory: (value: string) => void;
  onOrderPriority: (value: string) => void;
  onPaymentMode: (value: string) => void;
  onPaymentReference: (value: string) => void;
  onPaymentBankName: (value: string) => void;
  onPaymentScreenshot: (file?: File) => void;
}) {
  const hasOrder = isOrderOutcome(visitType, result, visitOutcomes);
  const hasPayment = isPaymentOutcome(visitType, visitOutcomes);
  const hasFollowup = needsNextFollowupOutcome(result, visitOutcomes);

  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-2">
      <select value={visitType} onChange={(e) => onVisitType(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
        {visitTypes.map((type) => <option key={type}>{type}</option>)}
      </select>
      <VisitOutcomeChips outcomes={visitOutcomes} onToggle={onToggleOutcome} />
      {!hasOrder && (
        <input value={nextAction} onChange={(e) => onNextAction(e.target.value)} placeholder="Next action" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
      )}
      {hasFollowup && (
        <input value={nextFollowupDate} onChange={(e) => onNextFollowup(e.target.value)} type="datetime-local" aria-label="Next Follow-up Date" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
      )}
      {hasPayment && (
        <PaymentFields
          visitType={visitType}
          paymentMode={paymentMode}
          paymentReference={paymentReference}
          paymentBankName={paymentBankName}
          paymentScreenshotUrl={paymentScreenshotUrl}
          recoveryAmount={recoveryAmount}
          onPaymentMode={onPaymentMode}
          onPaymentReference={onPaymentReference}
          onPaymentBankName={onPaymentBankName}
          onPaymentScreenshot={onPaymentScreenshot}
          onRecovery={onRecovery}
        />
      )}
      {hasOrder && (
        <>
          <textarea value={orderProductCategory} onChange={(e) => onOrderProductCategory(e.target.value)} placeholder="Order Details" className="min-h-28 rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900 md:col-span-2" />
          <input value={orderExpectedDelivery} onChange={(e) => onOrderExpectedDelivery(e.target.value)} type="date" aria-label="Preferred Delivery Date" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          <select value={orderPriority} onChange={(e) => onOrderPriority(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
            <option>Normal</option>
            <option>Urgent</option>
            <option>High</option>
          </select>
        </>
      )}
    </div>
  );
}

function VisitOutcomeChips({ outcomes, onToggle }: { outcomes: string[]; onToggle: (value: string) => void }) {
  return (
    <div className="md:col-span-2">
      <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Visit Outcomes</p>
      <div className="flex flex-wrap gap-2">
        {visitOutcomeOptions.map((outcome) => {
          const selected = outcomes.includes(outcome);
          return (
            <button
              key={outcome}
              type="button"
              onClick={() => onToggle(outcome)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                selected
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              }`}
            >
              {selected ? "Selected: " : ""}
              {outcome}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PaymentFields({
  visitType,
  paymentMode,
  paymentReference,
  paymentBankName,
  paymentScreenshotUrl,
  recoveryAmount,
  onPaymentMode,
  onPaymentReference,
  onPaymentBankName,
  onPaymentScreenshot,
  onRecovery,
}: {
  visitType: string;
  paymentMode: string;
  paymentReference: string;
  paymentBankName: string;
  paymentScreenshotUrl: string;
  recoveryAmount: string;
  onPaymentMode: (value: string) => void;
  onPaymentReference: (value: string) => void;
  onPaymentBankName: (value: string) => void;
  onPaymentScreenshot: (file?: File) => void;
  onRecovery: (value: string) => void;
}) {
  void visitType;
  return (
    <>
      <select value={paymentMode} onChange={(e) => onPaymentMode(e.target.value)} className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900">
        {paymentModes.map((mode) => <option key={mode}>{mode}</option>)}
      </select>
      {paymentMode !== "Cheque Collected" && (
        <input value={recoveryAmount} onChange={(e) => onRecovery(e.target.value)} inputMode="decimal" placeholder="Amount" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
      )}
      {paymentMode === "NEFT / RTGS" && (
        <>
          <input value={paymentReference} onChange={(e) => onPaymentReference(e.target.value)} placeholder="Reference number" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          <input value={paymentBankName} onChange={(e) => onPaymentBankName(e.target.value)} placeholder="Bank name" className="min-h-12 rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900" />
          <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-200">
            {paymentScreenshotUrl ? "Screenshot added" : "Upload screenshot"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => onPaymentScreenshot(event.target.files?.[0])} />
          </label>
        </>
      )}
    </>
  );
}

function StaffStatusPanel({ staff }: { staff: StaffStatus[] }) {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Live Staff Status</h2>
          <p className="text-sm text-slate-500">Monitoring-only view of active staff, open visits, and latest GPS.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {staff.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500 md:col-span-2">
            No staff activity is available for this shop yet.
          </p>
        ) : (
          staff.map((person) => (
            <div key={person.id} className="rounded-lg border p-3 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{person.name}</p>
                  <p className="text-xs text-slate-500">
                    {person.openVisit
                      ? `${person.openVisit.customer.partyName} - checked in ${formatDateTime(person.openVisit.checkInAt)}`
                      : person.latestLocation
                        ? `Last GPS ${formatDateTime(person.latestLocation.createdAt)}`
                        : "No GPS today"}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${person.openVisit ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                  {person.openVisit ? "IN PROGRESS" : person.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                {person.latestLocation && (
                  <>
                    <span>Accuracy: {person.latestLocation.accuracy ? `+/-${Math.round(person.latestLocation.accuracy)}m` : "-"}</span>
                    <span>{person.latestLocation.ageMinutes === null ? "Age: -" : `Age: ${person.latestLocation.ageMinutes} min`}</span>
                    <a href={person.latestLocation.googleMapsUrl} target="_blank" className="text-brand-600 hover:underline">
                      GPS map
                    </a>
                  </>
                )}
                {person.openVisit && <span>Mobile: {person.openVisit.customer.contactNumber}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function VisitChequeCollection({
  visit,
  location,
  onSaved,
}: {
  visit: ChequeCollectionContext;
  location: GeolocationPosition | null;
  onSaved: () => void;
}) {
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [form, setForm] = useState({
    chequeNumber: "",
    amount: "",
    bankName: "",
    branch: "",
    chequeDate: "",
    accountHolderName: visit.customer.partyName,
    notes: "",
    micrCode: "",
    ifscCode: "",
    ocrRawText: "",
  });

  const canSave =
    Boolean(visit.customer.id) &&
    form.chequeNumber.trim() &&
    Number(form.amount) > 0 &&
    form.bankName.trim() &&
    form.chequeDate &&
    form.accountHolderName.trim();

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleImage(file?: File) {
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = async () => {
      const value = String(reader.result || "");
      setImageDataUrl(value);
      await scan(value);
    };
    reader.readAsDataURL(file);
  }

  function normalizeDate(value?: string) {
    if (!value) return "";
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (!match) return "";
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  async function scan(image: string) {
    setScanning(true);
    const res = await fetch("/api/cheques/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: image }),
    });
    const result = await res.json();
    setScanning(false);
    setConfidence(result.confidence ?? 0);
    if (!result.ok) {
      setError(result.warning ?? "Could not detect all cheque details. Please verify manually.");
    }
    setForm((current) => ({
      ...current,
      chequeNumber: result.fields?.chequeNumber ?? current.chequeNumber,
      amount: result.fields?.amount ? String(result.fields.amount) : current.amount,
      bankName: result.fields?.bankName ?? current.bankName,
      branch: result.fields?.branch ?? current.branch,
      chequeDate: normalizeDate(result.fields?.chequeDate) || current.chequeDate,
      accountHolderName: result.fields?.accountHolderName ?? current.accountHolderName,
      micrCode: result.fields?.micrCode ?? current.micrCode,
      ifscCode: result.fields?.ifscCode ?? current.ifscCode,
      ocrRawText: result.rawText ?? current.ocrRawText,
    }));
  }

  async function saveCheque() {
    if (!canSave || !visit.customer.id) {
      setError("Please complete cheque number, amount, bank, date, and account holder.");
      return;
    }
    setSaving(true);
    setError("");
    const collectionLatitude = visit.checkInLat ?? location?.coords.latitude;
    const collectionLongitude = visit.checkInLng ?? location?.coords.longitude;
    const collectionAccuracy = visit.accuracy ?? location?.coords.accuracy;
    const collectionNotes = [
      form.notes.trim(),
      "Collected During Visit",
      visit.id ? `Visit: ${visit.id}` : "",
    ].filter(Boolean).join(" | ");
    const res = await fetch("/api/cheques", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: visit.customer.id,
        chequeNumber: form.chequeNumber.trim(),
        bankName: form.bankName.trim(),
        branch: form.branch || undefined,
        chequeDate: new Date(`${form.chequeDate}T00:00:00`).toISOString(),
        amount: Number(form.amount),
        accountHolderName: form.accountHolderName.trim(),
        collectionDateTime: new Date().toISOString(),
        collectionNotes,
        staffVisitId: visit.id || undefined,
        frontImageUrl: imageDataUrl || undefined,
        micrCode: form.micrCode || undefined,
        ifscCode: form.ifscCode || undefined,
        ocrRawText: form.ocrRawText || undefined,
        ocrConfidence: confidence ?? undefined,
        collectionLatitude,
        collectionLongitude,
        collectionAccuracy,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save cheque.");
      return;
    }
    setForm({
      chequeNumber: "",
      amount: "",
      bankName: "",
      branch: "",
      chequeDate: "",
      accountHolderName: visit.customer.partyName,
      notes: "",
      micrCode: "",
      ifscCode: "",
      ocrRawText: "",
    });
    setImageDataUrl("");
    onSaved();
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-brand-600">Centralized Cheque Collection</p>
          <h3 className="font-bold">{visit.customer.partyName}</h3>
          <p className="text-xs text-slate-500">{visit.customer.contactNumber} · Balance {money(visit.customer.outstandingBalance)}</p>
        </div>
        {confidence !== null && <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">OCR {Math.round(confidence * 100)}%</span>}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white">
          <Camera className="h-4 w-4" /> Camera
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => handleImage(event.target.files?.[0])} />
        </label>
        <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold">
          Upload from Gallery
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => handleImage(event.target.files?.[0])} />
        </label>
      </div>
      {imageDataUrl && (
        <div className="relative mt-3 h-52 w-full overflow-hidden rounded-lg border bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
          <Image src={imageDataUrl} alt="Cheque preview" fill unoptimized className="object-contain" />
        </div>
      )}
      {scanning && <p className="mt-2 text-sm text-blue-700">Scanning cheque...</p>}
      {error && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{error}</p>}
      {!visit.id && (
        <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-sm text-blue-800">
          Cheque will save directly to the centralized module. Visit and GPS details will attach when available.
        </p>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Input label="Bank Name" value={form.bankName} onChange={(value) => setField("bankName", value)} required />
        <Input label="Cheque Number" value={form.chequeNumber} onChange={(value) => setField("chequeNumber", value)} required />
        <Input label="Cheque date" type="date" value={form.chequeDate} onChange={(value) => setField("chequeDate", value)} required />
        <Input label="Amount" value={form.amount} onChange={(value) => setField("amount", value)} inputMode="decimal" required />
        <Input label="Account holder" value={form.accountHolderName} onChange={(value) => setField("accountHolderName", value)} required />
        <Input label="Branch" value={form.branch} onChange={(value) => setField("branch", value)} />
        <Input label="MICR" value={form.micrCode} onChange={(value) => setField("micrCode", value)} />
        <Input label="IFSC" value={form.ifscCode} onChange={(value) => setField("ifscCode", value)} />
      </div>
      <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Cheque notes" className="mt-3 min-h-20 w-full rounded-lg border px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      <button type="button" onClick={saveCheque} disabled={saving || !canSave} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? "Saving cheque..." : "Save Collected Cheque"}
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  inputMode?: "decimal" | "numeric" | "tel";
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}{required ? " *" : ""}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

