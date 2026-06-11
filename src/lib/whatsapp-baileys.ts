import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clearSessionSecrets, deleteSessionSecret, readSessionSecret, writeSessionSecret } from "@/lib/whatsapp-session-store";

type WhatsAppGroup = {
  jid: string;
  name: string;
  participants: number;
};

type SocketLike = {
  ev: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
  };
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
  groupFetchAllParticipating: () => Promise<Record<string, { id?: string; subject?: string; participants?: unknown[] }>>;
  logout?: () => Promise<void>;
  end?: (error?: Error) => void;
};

type BaileysRuntime = {
  makeWASocket: (options: Record<string, unknown>) => SocketLike;
  initAuthCreds: () => unknown;
  BufferJSON: { replacer: (key: string, value: unknown) => unknown; reviver: (key: string, value: unknown) => unknown };
  fetchLatestBaileysVersion: () => Promise<{ version: number[] }>;
  proto: { Message: { AppStateSyncKeyData: { fromObject: (value: unknown) => unknown } } };
  DisconnectReason: Record<string, number>;
};

type ShopClient = {
  socket: SocketLike;
  startedAt: number;
};

type ConnectionUpdatePayload = {
  connection?: string;
  qr?: string;
  isNewLogin?: boolean;
  receivedPendingNotifications?: boolean;
  lastDisconnect?: { error?: { output?: { statusCode?: number; payload?: unknown }; message?: string; stack?: string; name?: string; data?: unknown } };
};

const clients = new Map<string, ShopClient>();

function forceSafeWebSocketImplementation() {
  process.env.WS_NO_BUFFER_UTIL = "1";
  process.env.WS_NO_UTF_8_VALIDATE = "1";
}

async function loadBaileys(): Promise<BaileysRuntime> {
  forceSafeWebSocketImplementation();
  const baileys = await import("@whiskeysockets/baileys");
  const moduleWithDefault = baileys as typeof baileys & { default?: BaileysRuntime["makeWASocket"] };
  return {
    makeWASocket: (moduleWithDefault.default ?? baileys.makeWASocket) as BaileysRuntime["makeWASocket"],
    initAuthCreds: baileys.initAuthCreds as BaileysRuntime["initAuthCreds"],
    BufferJSON: baileys.BufferJSON as BaileysRuntime["BufferJSON"],
    fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion as BaileysRuntime["fetchLatestBaileysVersion"],
    proto: baileys.proto as BaileysRuntime["proto"],
    DisconnectReason: baileys.DisconnectReason as unknown as BaileysRuntime["DisconnectReason"],
  };
}

function encodeJson(runtime: BaileysRuntime, value: unknown) {
  return JSON.parse(JSON.stringify(value, runtime.BufferJSON.replacer)) as unknown;
}

function decodeJson(runtime: BaileysRuntime, value: unknown) {
  return JSON.parse(JSON.stringify(value), runtime.BufferJSON.reviver) as unknown;
}

async function createEncryptedAuthState(shopId: string, runtime: BaileysRuntime) {
  const storedCreds = await readSessionSecret<unknown>(shopId, "creds");
  const creds = storedCreds ? decodeJson(runtime, storedCreds) : runtime.initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const result: Record<string, unknown> = {};
          await Promise.all(ids.map(async (id) => {
            const value = await readSessionSecret<unknown>(shopId, `${type}:${id}`);
            if (!value) return;
            const decoded = decodeJson(runtime, value);
            result[id] = type === "app-state-sync-key" ? runtime.proto.Message.AppStateSyncKeyData.fromObject(decoded) : decoded;
          }));
          return result;
        },
        set: async (data: Record<string, Record<string, unknown | null>>) => {
          const writes: Promise<unknown>[] = [];
          for (const [type, values] of Object.entries(data)) {
            for (const [id, value] of Object.entries(values)) {
              const key = `${type}:${id}`;
              writes.push(value === null ? deleteSessionSecret(shopId, key) : writeSessionSecret(shopId, key, encodeJson(runtime, value)));
            }
          }
          await Promise.all(writes);
        },
      },
    },
    saveCreds: async () => writeSessionSecret(shopId, "creds", encodeJson(runtime, creds)),
  };
}

function hasRegisteredSession(state: { creds?: unknown }) {
  return Boolean((state.creds as { me?: unknown } | undefined)?.me);
}

function diagnosticTemplates(current: Prisma.JsonValue | null | undefined, patch: Record<string, unknown>) {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current as Prisma.JsonObject : {};
  const existingDiagnostics = base.whatsappDiagnostics && typeof base.whatsappDiagnostics === "object" && !Array.isArray(base.whatsappDiagnostics)
    ? base.whatsappDiagnostics as Prisma.JsonObject
    : {};
  return {
    ...base,
    whatsappDiagnostics: {
      ...existingDiagnostics,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  } satisfies Prisma.JsonObject;
}

async function updateWhatsAppDiagnostics(shopId: string, patch: Record<string, unknown>) {
  try {
    const setting = await prisma.whatsAppOrderNotificationSetting.findUnique({
      where: { shopId },
      select: { templates: true },
    });
    if (!setting) return;
    await prisma.whatsAppOrderNotificationSetting.update({
      where: { shopId },
      data: { templates: diagnosticTemplates(setting.templates, patch) },
    });
  } catch (error) {
    logger.error("whatsapp_diagnostics_persist_failed", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

function parseDisconnectReason(update: ConnectionUpdatePayload, disconnectReasonMap: Record<string, number>) {
  const statusCode = update.lastDisconnect?.error?.output?.statusCode;
  const reasonName = Object.entries(disconnectReasonMap).find(([, code]) => code === statusCode)?.[0] ?? null;
  const message = update.lastDisconnect?.error?.message ?? null;
  return {
    statusCode,
    reasonName,
    message,
    name: update.lastDisconnect?.error?.name ?? null,
    payload: update.lastDisconnect?.error?.output?.payload ?? null,
  };
}

export async function startWhatsAppSession(shopId: string) {
  const existing = clients.get(shopId);
  if (existing) return existing.socket;

  logger.info("whatsapp_connect_start", { shopId });
  forceSafeWebSocketImplementation();

  await prisma.whatsAppOrderNotificationSetting.upsert({
    where: { shopId },
    update: {
      connectionStatus: "CONNECTING",
      lastError: null,
    },
    create: {
      shopId,
      connectionStatus: "CONNECTING",
    },
  });
  await updateWhatsAppDiagnostics(shopId, {
    lastConnectionState: "CONNECTING",
    lastPairingError: null,
    socketStartedAt: new Date().toISOString(),
    runtime: process.env.VERCEL ? "vercel" : "node",
  });

  const runtime = await loadBaileys();
  const { state, saveCreds } = await createEncryptedAuthState(shopId, runtime);
  if (!hasRegisteredSession(state)) {
    logger.info("whatsapp_registration_start", { shopId });
  }
  const { version } = await runtime.fetchLatestBaileysVersion();
  const socket = runtime.makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    browser: ["UdharBook", "Chrome", "1.0.0"],
  });

  socket.ev.on("creds.update", (credsUpdate: unknown) => {
    const hasMe = Boolean((credsUpdate as { me?: unknown } | undefined)?.me || (state.creds as { me?: unknown } | undefined)?.me);
    logger.info("whatsapp_creds_update", { shopId, hasMe });
    void saveCreds()
      .then(() => {
        logger.info("whatsapp_creds_persisted", { shopId, hasMe });
        return updateWhatsAppDiagnostics(shopId, {
          lastCredsSavedAt: new Date().toISOString(),
          lastCredsSaveError: null,
          hasRegisteredCreds: hasMe,
        });
      })
      .catch((error) => {
        logger.error("whatsapp_creds_persist_failed", {
          shopId,
          hasMe,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return updateWhatsAppDiagnostics(shopId, {
          lastCredsSaveError: error instanceof Error ? error.message : String(error),
          hasRegisteredCreds: hasMe,
        });
      });
  });

  socket.ev.on("connection.update", (update: unknown) => {
    const payload = update as ConnectionUpdatePayload;
    void handleConnectionUpdate(shopId, payload, runtime.DisconnectReason);
  });

  clients.set(shopId, { socket, startedAt: Date.now() });
  return socket;
}

async function handleConnectionUpdate(
  shopId: string,
  update: ConnectionUpdatePayload,
  disconnectReason: Record<string, number>,
) {
  const reason = parseDisconnectReason(update, disconnectReason);
  logger.info("whatsapp_connection_update", {
    shopId,
    connection: update.connection ?? null,
    hasQr: Boolean(update.qr),
    isNewLogin: update.isNewLogin ?? null,
    receivedPendingNotifications: update.receivedPendingNotifications ?? null,
    disconnectReason: reason.reasonName,
    statusCode: reason.statusCode ?? null,
    error: reason.message,
  });
  await updateWhatsAppDiagnostics(shopId, {
    lastConnectionState: update.connection ?? (update.qr ? "QR_GENERATED" : "UNKNOWN"),
    lastDisconnectReason: reason.reasonName ?? reason.message ?? null,
    lastDisconnectStatusCode: reason.statusCode ?? null,
  });

  if (update.isNewLogin) {
    logger.info("whatsapp_pairing_success", { shopId });
    await updateWhatsAppDiagnostics(shopId, { lastPairingError: null, lastPairingSuccessAt: new Date().toISOString() });
  }

  if (update.qr) {
    logger.info("whatsapp_qr_generated", { shopId });
    await prisma.whatsAppOrderNotificationSetting.upsert({
      where: { shopId },
      update: {
        connectionStatus: "CONNECTING",
        lastQrCode: update.qr,
        lastError: null,
      },
      create: {
        shopId,
        connectionStatus: "CONNECTING",
        lastQrCode: update.qr,
      },
    });
    await updateWhatsAppDiagnostics(shopId, { lastConnectionState: "QR_GENERATED", lastPairingError: null });
  }

  if (update.connection === "open") {
    logger.info("whatsapp_connection_open", { shopId });
    await prisma.whatsAppOrderNotificationSetting.update({
      where: { shopId },
      data: { connectionStatus: "CONNECTED", lastQrCode: null, lastConnectedAt: new Date(), lastError: null },
    });
    await updateWhatsAppDiagnostics(shopId, {
      lastConnectionState: "CONNECTED",
      lastPairingError: null,
      lastDisconnectReason: null,
      connectedAt: new Date().toISOString(),
    });
  }

  if (update.connection === "close") {
    clients.delete(shopId);
    const statusCode = reason.statusCode;
    const loggedOut = statusCode === disconnectReason.loggedOut;
    const pairingError = reason.reasonName ?? reason.message ?? "Connection closed before pairing completed";
    logger.error("whatsapp_pairing_failure", {
      shopId,
      statusCode,
      reason: reason.reasonName,
      error: reason.message,
      stack: update.lastDisconnect?.error?.stack,
    });
    logger.error("whatsapp_connection_error", {
      shopId,
      statusCode,
      loggedOut,
      reason: reason.reasonName,
      error: reason.message,
    });
    await prisma.whatsAppOrderNotificationSetting.update({
      where: { shopId },
      data: {
        connectionStatus: loggedOut ? "LOGGED_OUT" : "DISCONNECTED",
        lastDisconnectedAt: new Date(),
        lastError: pairingError,
      },
    });
    await updateWhatsAppDiagnostics(shopId, {
      lastConnectionState: loggedOut ? "LOGGED_OUT" : "DISCONNECTED",
      lastDisconnectReason: pairingError,
      lastDisconnectStatusCode: statusCode ?? null,
      lastPairingError: pairingError,
      lastPairingFailureAt: new Date().toISOString(),
    });
    if (!loggedOut) {
      setTimeout(() => {
        void startWhatsAppSession(shopId).catch((error) => {
          logger.error("whatsapp_reconnect_failed", { shopId, error: error instanceof Error ? error.message : String(error) });
        });
      }, 5000);
    }
  }
}

export async function getWhatsAppGroups(shopId: string): Promise<WhatsAppGroup[]> {
  const socket = await startWhatsAppSession(shopId);
  const groups = await socket.groupFetchAllParticipating();
  return Object.entries(groups)
    .map(([jid, group]) => ({
      jid: group.id ?? jid,
      name: group.subject ?? "Unnamed group",
      participants: group.participants?.length ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function sendWhatsAppGroupMessage(shopId: string, groupJid: string, message: string) {
  const socket = await startWhatsAppSession(shopId);
  await socket.sendMessage(groupJid, { text: message });
}

export async function logoutWhatsAppSession(shopId: string) {
  const client = clients.get(shopId);
  await client?.socket.logout?.().catch(() => undefined);
  client?.socket.end?.(new Error("Admin requested WhatsApp logout"));
  clients.delete(shopId);
  await clearSessionSecrets(shopId);
  await prisma.whatsAppOrderNotificationSetting.update({
    where: { shopId },
    data: { connectionStatus: "DISCONNECTED", lastQrCode: null, lastDisconnectedAt: new Date() },
  });
}
