import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('.output/server/index.mjs');
if (!existsSync(output)) {
  console.error(`Desktop packaging requires a successful TanStack/Nitro build. Missing: ${output}`);
  process.exit(1);
}
console.log(`Desktop server detected: ${output}`);
