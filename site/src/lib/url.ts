/** Site-relative URL that respects the GitHub Pages base path. `url('learn/ch07/')` → `/model-citizen/learn/ch07/`. */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
  return base + path.replace(/^\/+/, '');
}
