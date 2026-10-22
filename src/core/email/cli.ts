import { loadConfig } from '../config/index.js';
import { createDatabase } from '../db/database.js';
import { createPool } from '../db/pool.js';
import { DisabledMailer } from './mailer.js';
import { EmailWorker } from './worker.js';

const cfg = loadConfig(process.env);
// A concrete provider and its verified webhook adapter are a separate deployment gate.
if (cfg.EMAIL_DELIVERY_ENABLED)
  throw new Error('No production mailer is configured; leave EMAIL_DELIVERY_ENABLED=false');
const pool = createPool(cfg);
try {
  process.stdout.write(
    `${JSON.stringify(await new EmailWorker(createDatabase(pool), cfg, new DisabledMailer()).runBatch())}\n`,
  );
} finally {
  await pool.end();
}
