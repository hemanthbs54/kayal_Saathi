import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { isMock } from './src/ai.js';

const root = path.dirname(fileURLToPath(import.meta.url));
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const app = createApp({
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(root, 'uploads'),
  publicDir: path.join(root, 'public'),
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Kayal Saathi running on http://localhost:${port}  (dashboard: /dashboard)`);
  if (isMock()) console.log('MOCK mode: no SARVAM_API_KEY set (or MOCK=1). AI responses are simulated.');
});
