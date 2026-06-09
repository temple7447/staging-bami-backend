/**
 * migrateRentBaseline.js — NO-OP
 *
 * This migration script previously initialised baseRent2024 / baseServiceCharge2024
 * and related "last increase date" fields on Unit and Tenant documents.
 * Those fields have been removed from both models and all production code.
 * This file is kept as a no-op so any tooling that references it does not break.
 */

console.log('migrateRentBaseline: fields have been removed — nothing to migrate.');
process.exit(0);
