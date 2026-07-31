import { customType } from "drizzle-orm/pg-core";

export const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

export const bytea = customType<{ data: Buffer }>({
  dataType: () => "bytea",
});
