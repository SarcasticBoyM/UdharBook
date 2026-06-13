export const notificationPriorities = ["CRITICAL", "IMPORTANT", "NORMAL"] as const;

export type NotificationPriorityValue = (typeof notificationPriorities)[number];

export type NotificationEventPolicy = {
  priority: NotificationPriorityValue;
  toast: boolean;
  push: boolean;
  persistent: boolean;
  bypassQuietHours: boolean;
  shopRoles?: readonly string[];
};

const ACCOUNTS_ROLES = [
  "SHOP_ADMIN",
  "ACCOUNT_STAFF",
  "SALES_PERSON_CUM_ACCOUNTS",
] as const;

export const OPERATIONAL_NOTIFICATION_ROLES = [
  "SHOP_ADMIN",
  "SALES_PERSON",
  "ACCOUNT_STAFF",
  "SALES_PERSON_CUM_ACCOUNTS",
] as const;

const NORMAL_POLICY: NotificationEventPolicy = {
  priority: "NORMAL",
  toast: false,
  push: false,
  persistent: false,
  bypassQuietHours: false,
};

export const notificationEventPolicies = {
  CHEQUE_BOUNCED: {
    priority: "CRITICAL",
    toast: true,
    push: true,
    persistent: true,
    bypassQuietHours: true,
    shopRoles: ACCOUNTS_ROLES,
  },
  TASK_OVERDUE: {
    priority: "CRITICAL",
    toast: true,
    push: true,
    persistent: true,
    bypassQuietHours: true,
  },
  ORDER_CREATED: {
    priority: "IMPORTANT",
    toast: true,
    push: true,
    persistent: false,
    bypassQuietHours: false,
    shopRoles: OPERATIONAL_NOTIFICATION_ROLES,
  },
  TASK_ASSIGNED: {
    priority: "IMPORTANT",
    toast: true,
    push: true,
    persistent: false,
    bypassQuietHours: false,
  },
  CHEQUE_DEPOSITED: {
    priority: "IMPORTANT",
    toast: true,
    push: true,
    persistent: false,
    bypassQuietHours: false,
    shopRoles: ACCOUNTS_ROLES,
  },
  FOLLOW_UP_COMPLETED: NORMAL_POLICY,
  CUSTOMER_ADDED: NORMAL_POLICY,
} satisfies Record<string, NotificationEventPolicy>;

export const roleRestrictedShopEventTypes = Object.entries(notificationEventPolicies)
  .filter(([, policy]) => "shopRoles" in policy && Boolean(policy.shopRoles))
  .map(([eventType]) => eventType);

export function notificationPolicy(eventType: string): NotificationEventPolicy {
  return notificationEventPolicies[eventType as keyof typeof notificationEventPolicies] ?? NORMAL_POLICY;
}

export function notificationPriority(eventType: string): NotificationPriorityValue {
  return notificationPolicy(eventType).priority;
}

export function priorityRank(priority: NotificationPriorityValue) {
  if (priority === "CRITICAL") return 0;
  if (priority === "IMPORTANT") return 1;
  return 2;
}

export function canRoleSeeShopNotification(eventType: string, role: string) {
  const roles = notificationPolicy(eventType).shopRoles;
  return !roles || (roles as readonly string[]).includes(role);
}

export function isQuietHours(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date));
  return hour >= 21 || hour < 8;
}

export function shouldToastNotification(eventType: string) {
  return notificationPolicy(eventType).toast;
}

export function shouldPushNotification(eventType: string, date = new Date()) {
  const policy = notificationPolicy(eventType);
  if (!policy.push) return false;
  return policy.bypassQuietHours || !isQuietHours(date);
}

export function notificationCategory(eventType: string, entityType?: string | null) {
  const event = eventType.toUpperCase();
  const entity = entityType?.toUpperCase();
  if (event.startsWith("ORDER_") || entity === "ORDER") return "ORDERS";
  if (event.startsWith("TASK_") || entity === "TASK") return "TASKS";
  if (event.startsWith("CHEQUE_") || entity === "CHEQUE") return "CHEQUES";
  if (event.startsWith("FOLLOW_UP_") || entity === "FOLLOW_UP") return "FOLLOW_UPS";
  return "OTHER";
}
