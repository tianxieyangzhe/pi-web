import path from 'node:path';
// Captured once before selecting any business Session cwd.
export const applicationConfigRoot = path.resolve(process.env.INIT_CWD || process.cwd());
