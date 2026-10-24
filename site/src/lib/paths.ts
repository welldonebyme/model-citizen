// Build-time paths (Astro runs the build from the site folder; import.meta.url points into the bundle).
import { resolve } from 'node:path';
export const siteRoot = process.cwd();
export const publicPath = (...p: string[]) => resolve(siteRoot, 'public', ...p);
