import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createDbClient } from "./client";
import { apiKeys, orgs } from "./schema";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/photon";
  const { db, close } = createDbClient({ url });

  try {
    const slug = `dev-${randomUUID().slice(0, 8)}`;
    const [org] = await db
      .insert(orgs)
      .values({ slug, name: "Dev Org", urlSignKey: randomBytes(32) })
      .returning();
    if (!org) throw new Error("failed to insert dev org");

    const rawKey = `imgsk_${randomBytes(24).toString("base64url")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 8);

    await db.insert(apiKeys).values({
      orgId: org.id,
      name: "dev seed key",
      keyPrefix,
      keyHash,
    });

    console.log(`org:      ${org.slug} (${org.id})`);
    console.log(`api key:  ${rawKey}`);
    console.log("(raw key is shown once — only its hash is stored)");
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
