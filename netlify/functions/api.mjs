import { getDatabase } from '@netlify/database';
import { createHandler } from '../../lib/app.js';
import { resilientPool } from '../../lib/db.js';

// قاعدة Netlify القديمة (لنقل المعطيات منها مرة واحدة)
function netlifyPool() {
  try {
    return getDatabase().pool;
  } catch {
    return null;
  }
}

// DATABASE_URL = رابط Supabase. دونه نبقى على قاعدة Netlify
const supabaseUrl = process.env.DATABASE_URL;
const handle = supabaseUrl
  ? createHandler(resilientPool(supabaseUrl), { engine: 'supabase', migrationSource: netlifyPool() })
  : createHandler(netlifyPool(), { engine: 'netlify' });

export default (request) => handle(request);

export const config = { path: '/api/*' };
