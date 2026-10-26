import { loadConfig } from '../config/index.js';
import { createDatabase } from '../db/database.js';
import { createPool } from '../db/pool.js';
import { productionMailer } from './production-mailer.js';
import { EmailWorker } from './worker.js';

const cfg = loadConfig(process.env);
const mailer = productionMailer(cfg);
const pool = createPool(cfg);
try {
  process.stdout.write(
    `${JSON.stringify(await new EmailWorker(createDatabase(pool), cfg, mailer).runBatch())}\n`,
  );
} finally {
  await pool.end();
}
