"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, LogOut, MessageCircle, PlugZap, RefreshCw, Send, ToggleLeft, ToggleRight } from "lucide-react";
import { ORDER_WHATSAPP_EVENTS } from "@/lib/whatsapp-order-notifications";

type Setting = {
  enabled: boolean;
  groupJid: string | null;
  groupName: string | null;
  selectedEvents: string[];
  connectionStatus: string;
  qrCodeImage?: string | null;
  lastError?: string | null;
  lastDisconnectReason?: string | null;
  lastConnectionState?: string | null;
  lastPairingError?: string | null;
  lastCredsSavedAt?: string | null;
  lastCredsSaveError?: string | null;
  hasRegisteredCreds?: boolean | null;
};

type Group = { jid: string; name: string; participants: number };
type Job = { id: string; event: string; status: string; retryCount: number; lastError: string | null; targetGroupName: string | null; createdAt: string; sentAt: string | null };
type WhatsAppAction = "CONNECT" | "GROUPS" | "TEST" | "LOGOUT";

const eventLabels: Record<string, string> = {
  ORDER_CREATED: "New Order Created",
  ORDER_EDITED: "Order Edited",
  ORDER_DISPATCHED: "Order Dispatched",
  ORDER_DELIVERED: "Order Delivered",
  ORDER_CANCELLED: "Order Cancelled",
};

export default function WhatsAppOrderNotificationsPage() {
  const [setting, setSetting] = useState<Setting | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const selectedGroup = useMemo(() => groups.find((group) => group.jid === setting?.groupJid), [groups, setting?.groupJid]);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/whatsapp/settings");
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMessage(data.error ?? "Could not load WhatsApp settings.");
      return;
    }
    if (data.success === false) {
      setMessage(data.error ?? "WhatsApp settings are not available.");
      setSetting(null);
      setJobs([]);
      return;
    }
    setSetting(data.setting);
    setJobs(data.recentJobs ?? []);
  }

  async function save(patch: Partial<Setting>) {
    setMessage("");
    const res = await fetch("/api/whatsapp/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error ?? "Could not save settings.");
      return;
    }
    if (data.success === false) {
      setMessage(data.error ?? "WhatsApp settings are not available.");
      return;
    }
    setSetting(data.setting);
  }

  async function action(name: WhatsAppAction) {
    setBusy(name);
    setMessage("");
    const endpoint: Record<WhatsAppAction, string> = {
      CONNECT: "/api/whatsapp/connect",
      GROUPS: "/api/whatsapp/groups",
      TEST: "/api/whatsapp/test",
      LOGOUT: "/api/whatsapp/logout",
    };
    const res = await fetch(endpoint[name], { method: name === "GROUPS" ? "GET" : "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setMessage(data.error ?? "WhatsApp action failed.");
      return;
    }
    if (data.setting) setSetting(data.setting);
    if (data.groups) setGroups(data.groups);
    if (name === "TEST") setMessage("Test notification sent.");
    if (name === "LOGOUT") await load();
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleEvent(event: string) {
    if (!setting) return;
    const selectedEvents = setting.selectedEvents.includes(event)
      ? setting.selectedEvents.filter((item) => item !== event)
      : [...setting.selectedEvents, event];
    await save({ selectedEvents });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp Order Notifications</h1>
          <p className="text-slate-500">Send Order Desk updates to one selected WhatsApp group.</p>
        </div>
        <button type="button" onClick={load} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {message && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{message}</div>}
      {loading && <div className="mt-6 rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">Loading WhatsApp settings...</div>}

      {setting && (
        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="space-y-4">
            <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">Order Notification Group</h2>
                  <p className="text-sm text-slate-500">Status: {setting.connectionStatus.replace(/_/g, " ")}</p>
                </div>
                <button type="button" onClick={() => save({ enabled: !setting.enabled })} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-100 px-3 text-sm font-semibold dark:bg-slate-800">
                  {setting.enabled ? <ToggleRight className="h-5 w-5 text-emerald-600" /> : <ToggleLeft className="h-5 w-5 text-slate-500" />}
                  {setting.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy === "CONNECT"} onClick={() => action("CONNECT")} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white disabled:opacity-60">
                  <PlugZap className="h-4 w-4" />
                  {busy === "CONNECT" ? "Connecting..." : "Connect WhatsApp"}
                </button>
                <button type="button" disabled={busy === "GROUPS"} onClick={() => action("GROUPS")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700 disabled:opacity-60">
                  <MessageCircle className="h-4 w-4" />
                  {busy === "GROUPS" ? "Loading..." : "Choose Group"}
                </button>
                <button type="button" disabled={!setting.groupJid || busy === "TEST"} onClick={() => action("TEST")} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
                  <Send className="h-4 w-4" />
                  Test
                </button>
                <button type="button" disabled={busy === "LOGOUT"} onClick={() => action("LOGOUT")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-700 disabled:opacity-60">
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>

              {setting.qrCodeImage && (
                <div className="mt-4 inline-block rounded-lg border bg-white p-3">
                  <Image src={setting.qrCodeImage} alt="WhatsApp connection QR code" width={240} height={240} unoptimized className="h-60 w-60" />
                </div>
              )}

              {setting.lastError && <p className="mt-3 text-sm text-red-600">{setting.lastError}</p>}
            </div>

            {groups.length > 0 && (
              <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h2 className="font-bold">Select Target Group</h2>
                <div className="mt-3 space-y-2">
                  {groups.map((group) => (
                    <button
                      key={group.jid}
                      type="button"
                      onClick={() => save({ groupJid: group.jid, groupName: group.name })}
                      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm ${setting.groupJid === group.jid ? "border-emerald-400 bg-emerald-50 text-emerald-900" : "border-slate-200 dark:border-slate-700"}`}
                    >
                      <span className="font-semibold">{group.name}</span>
                      <span className="text-xs text-slate-500">{group.participants} members</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="font-bold">Send Events</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {ORDER_WHATSAPP_EVENTS.map((event) => (
                  <button key={event} type="button" onClick={() => toggleEvent(event)} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 text-left text-sm dark:border-slate-700">
                    <span className="font-semibold">{eventLabels[event]}</span>
                    {setting.selectedEvents.includes(event) ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <span className="h-5 w-5 rounded-full border border-slate-300" />}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="rounded-lg border bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-bold">Queue Status</h2>
            <p className="mt-1 text-sm text-slate-500">{selectedGroup ? `Group: ${selectedGroup.name}` : setting.groupName ? `Group: ${setting.groupName}` : "No group selected"}</p>
            <div className="mt-4 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
              <p><span className="font-semibold">Connection:</span> {setting.lastConnectionState ?? setting.connectionStatus}</p>
              <p className="mt-1"><span className="font-semibold">Disconnect:</span> {setting.lastDisconnectReason ?? "-"}</p>
              <p className="mt-1"><span className="font-semibold">Pairing:</span> {setting.lastPairingError ?? "-"}</p>
              <p className="mt-1"><span className="font-semibold">Session Saved:</span> {setting.lastCredsSavedAt ? "Yes" : "No"}</p>
              {setting.lastCredsSaveError && <p className="mt-1 text-red-600">{setting.lastCredsSaveError}</p>}
            </div>
            <div className="mt-4 space-y-3">
              {jobs.length === 0 && <p className="text-sm text-slate-500">No notifications queued yet.</p>}
              {jobs.map((job) => (
                <div key={job.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{eventLabels[job.event] ?? job.event}</span>
                    <span className="text-xs font-bold">{job.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Retries: {job.retryCount}</p>
                  {job.lastError && <p className="mt-1 text-xs text-red-600">{job.lastError}</p>}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
