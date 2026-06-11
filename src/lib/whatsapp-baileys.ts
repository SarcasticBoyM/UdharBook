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

const clients = new Map<string, ShopClient>();

async function loadBaileys(): Promise<BaileysRuntime> {
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

export async function startWhatsAppSession(shopId: string) {
  const existing = clients.get(shopId);
  if (existing) return existing.socket;

  await prisma.whatsAppOrderNotificationSetting.upsert({
    where: { shopId },
    update: { connectionStatus: "CONNECTING", lastError: null },
    create: { shopId, connectionStatus: "CONNECTING" },
  });

  const runtime = await loadBaileys();
  const { state, saveCreds } = await createEncryptedAuthState(shopId, runtime);
  const { version } = await runtime.fetchLatestBaileysVersion();
  const socket = runtime.makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    browser: ["UdharBook", "Chrome", "1.0.0"],
  });

  socket.ev.on("creds.update", () => {
    void saveCreds();
  });

  socket.ev.on("connection.update", (update: unknown) => {
    const payload = update as { connection?: string; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } } };
    void handleConnectionUpdate(shopId, payload, runtime.DisconnectReason);
  });

  clients.set(shopId, { socket, startedAt: Date.now() });
  return socket;
}

async function handleConnectionUpdate(
  shopId: string,
  update: { connection?: string; qr?: string; lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } } },
  disconnectReason: Record<string, number>,
) {
  if (update.qr) {
    await prisma.whatsAppOrderNotificationSetting.upsert({
      where: { shopId },
      update: { connectionStatus: "CONNECTING", lastQrCode: update.qr, lastError: null },
      create: { shopId, connectionStatus: "CONNECTING", lastQrCode: update.qr },
    });
  }

  if (update.connection === "open") {
    await prisma.whatsAppOrderNotificationSetting.update({
      where: { shopId },
      data: { connectionStatus: "CONNECTED", lastQrCode: null, lastConnectedAt: new Date(), lastError: null },
    });
  }

  if (update.connection === "close") {
    clients.delete(shopId);
    const statusCode = update.lastDisconnect?.error?.output?.statusCode;
    const loggedOut = statusCode === disconnectReason.loggedOut;
    await prisma.whatsAppOrderNotificationSetting.update({
      where: { shopId },
      data: {
        connectionStatus: loggedOut ? "LOGGED_OUT" : "DISCONNECTED",
        lastDisconnectedAt: new Date(),
        lastError: update.lastDisconnect?.error?.message ?? null,
      },
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
