import { getDatabase } from '@netlify/database';
import { createHandler } from '../../lib/app.js';

const handle = createHandler(getDatabase().pool);

export default (request) => handle(request);

export const config = { path: '/api/*' };
