import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const metrics = sqliteTable("metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectedAt: text("collected_at").notNull(),
  metricKey: text("metric_key").notNull(),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  value: integer("value").notNull(),
  display: text("display").notNull(),
  resetText: text("reset_text"),
});
