// Unisce i pezzi del narratore in UN file da incollare su Supabase
// (Edge Functions → Deploy a new function → Via Editor, nome "narratore"):
//
//   src/narrator/core.ts                 regole condivise col gioco
//   src/narrator/server.ts               logica della funzione
//   supabase/functions/narratore/deno.ts collegamento a Supabase e Claude
//
// Uso: node scripts/narratore-funzione.mjs            (scrive index.ts)
//      node scripts/narratore-funzione.mjs --controlla (errore se index.ts è vecchio)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'supabase/functions/narratore/index.ts');

export function build() {
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const core = read('src/narrator/core.ts');
  const server = read('src/narrator/server.ts').replace(/^import \{[\s\S]*?\} from '\.\/core';\n/m, '');
  let deno = read('supabase/functions/narratore/deno.ts').replace(/^import .* from '\.\.\/\.\.\/\.\.\/src\/narrator\/.*';\n/gm, '');
  // le librerie esterne in cima al file
  const imports = deno.match(/^import .* from 'npm:.*';$/gm) ?? [];
  deno = deno.replace(/^import .* from 'npm:.*';\n/gm, '');
  if (/from '\.\/core'/.test(server) || /src\/narrator/.test(deno.replace(/^\/\/.*$/gm, ''))) throw new Error('import non rimossi');
  return [
    '// FILE GENERATO da scripts/narratore-funzione.mjs: non modificarlo a mano.',
    '// Funzione Supabase "narratore" di Le Fratture: si incolla tutto così com\'è.',
    '',
    ...imports,
    '',
    '// ===== src/narrator/core.ts =====',
    core.trim(),
    '',
    '// ===== src/narrator/server.ts =====',
    server.trim(),
    '',
    '// ===== supabase/functions/narratore/deno.ts =====',
    deno.trim(),
    '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = build();
  if (process.argv.includes('--controlla')) {
    let cur = '';
    try {
      cur = readFileSync(OUT, 'utf8');
    } catch {
      /* manca */
    }
    if (cur !== text) {
      console.error('supabase/functions/narratore/index.ts è vecchio: esegui node scripts/narratore-funzione.mjs');
      process.exit(1);
    }
    console.log('index.ts aggiornato');
  } else {
    writeFileSync(OUT, text);
    console.log(`Scritto ${OUT} (${text.length} caratteri)`);
  }
}
