import type { Db } from "@/lib/db";

export async function audit(
  db: Db,
  entry: {
    orgId: string | null;
    actorType: "user" | "system" | "platform_admin";
    actorId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.query(
    `insert into audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id, metadata)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [entry.orgId, entry.actorType, entry.actorId ?? null, entry.action, entry.targetType ?? null, entry.targetId ?? null,
     entry.metadata ? JSON.stringify(entry.metadata) : null],
  );
}
