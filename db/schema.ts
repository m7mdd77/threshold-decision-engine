// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const demoSandboxes=sqliteTable('demo_sandboxes',{id:text('id').primaryKey(),payload:text('payload').notNull(),revision:integer('revision').notNull(),expires:integer('expires').notNull()},t=>[index('sandbox_expiry_idx').on(t.expires)]);
export const demoLimits=sqliteTable('demo_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull()},t=>[index('limit_expiry_idx').on(t.expires)]);
