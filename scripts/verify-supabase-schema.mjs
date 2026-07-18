import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const expectedTables = [
  'profiles', 'user_roles', 'stores', 'store_documents', 'store_delivery_zones', 'categories',
  'products', 'product_option_groups', 'product_option_items', 'addresses', 'couriers',
  'courier_documents', 'coupons', 'orders', 'order_items', 'order_financials',
  'coupon_redemptions', 'payments', 'delivery_assignments', 'order_status_history',
  'reviews', 'order_messages', 'notifications', 'loyalty_accounts', 'loyalty_transactions', 'audit_logs'
];

const files = (await readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
if (files.join(',') !== '20260718000100_foundation.sql,20260718000200_rls_policies.sql,20260718000300_order_transactions.sql,20260718000400_realtime.sql') {
  throw new Error(`Unexpected migration sequence: ${files.join(', ')}`);
}
const source = await Promise.all(files.map(async file => [file, await readFile(join(migrationsDir, file), 'utf8')]));
const sql = Object.fromEntries(source);
const allSql = source.map(([, text]) => text).join('\n');

for (const [file, text] of source) {
  if (!text.trimStart().startsWith('--') || !text.includes('begin;') || !text.includes('commit;')) {
    throw new Error(`${file} must be a documented transaction`);
  }
}
for (const table of expectedTables) {
  if (!sql['20260718000100_foundation.sql'].includes(`create table public.${table}`)) {
    throw new Error(`Missing central table: ${table}`);
  }
  if (!sql['20260718000200_rls_policies.sql'].includes(`alter table public.${table} enable row level security;`)) {
    throw new Error(`RLS is missing for: ${table}`);
  }
}
for (const fn of ['create_order', 'assign_courier', 'transition_order']) {
  if (!sql['20260718000300_order_transactions.sql'].includes(`function public.${fn}`)) {
    throw new Error(`Missing critical transaction function: ${fn}`);
  }
}
for (const guard of ['client_request_id', 'for update', 'coupon_redemptions', 'version = version + 1']) {
  if (!sql['20260718000300_order_transactions.sql'].toLowerCase().includes(guard)) {
    throw new Error(`Missing concurrency guard: ${guard}`);
  }
}
if (/(SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^\s]+)/.test(allSql)) {
  throw new Error('A service role key must never exist in a migration');
}
console.log(`Schema verification passed: ${files.length} migrations, ${expectedTables.length} RLS tables.`);
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const expectedTables = [
  'profiles', 'user_roles', 'stores', 'store_documents', 'store_delivery_zones', 'categories',
  'products', 'product_option_groups', 'product_option_items', 'addresses', 'couriers',
  'courier_documents', 'coupons', 'orders', 'order_items', 'order_financials',
  'coupon_redemptions', 'payments', 'delivery_assignments', 'order_status_history',
  'reviews', 'order_messages', 'notifications', 'loyalty_accounts', 'loyalty_transactions', 'audit_logs'
];

const files = (await readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
if (files.join(',') !== '20260718000100_foundation.sql,20260718000200_rls_policies.sql,20260718000300_order_transactions.sql') {
  throw new Error(`Unexpected migration sequence: ${files.join(', ')}`);
}
const source = await Promise.all(files.map(async file => [file, await readFile(join(migrationsDir, file), 'utf8')]));
const sql = Object.fromEntries(source);
const allSql = source.map(([, text]) => text).join('\n');

for (const [file, text] of source) {
  if (!text.trimStart().startsWith('--') || !text.includes('begin;') || !text.includes('commit;')) {
    throw new Error(`${file} must be a documented transaction`);
  }
}
for (const table of expectedTables) {
  if (!sql['20260718000100_foundation.sql'].includes(`create table public.${table}`)) {
    throw new Error(`Missing central table: ${table}`);
  }
  if (!sql['20260718000200_rls_policies.sql'].includes(`alter table public.${table} enable row level security;`)) {
    throw new Error(`RLS is missing for: ${table}`);
  }
}
for (const fn of ['create_order', 'assign_courier', 'transition_order']) {
  if (!sql['20260718000300_order_transactions.sql'].includes(`function public.${fn}`)) {
    throw new Error(`Missing critical transaction function: ${fn}`);
  }
}
for (const guard of ['client_request_id', 'for update', 'coupon_redemptions', 'version = version + 1']) {
  if (!sql['20260718000300_order_transactions.sql'].toLowerCase().includes(guard)) {
    throw new Error(`Missing concurrency guard: ${guard}`);
  }
}
if (/(SUPABASE_SERVICE_ROLE_KEY\s*=\s*[^\s]+)/.test(allSql)) {
  throw new Error('A service role key must never exist in a migration');
}
console.log(`Schema verification passed: ${files.length} migrations, ${expectedTables.length} RLS tables.`);
