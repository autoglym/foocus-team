import fs from 'fs';
import dotenv from 'dotenv';

// Runs before any test module is imported (jest setupFiles), so db.ts and
// services see these values. The tests wipe the database, so .env.test should
// point DATABASE_URL at a separate schema (e.g. ?schema=app_test).
if (fs.existsSync('.env.test')) {
  dotenv.config({ path: '.env.test', override: true, quiet: true });
}
dotenv.config({ quiet: true });
