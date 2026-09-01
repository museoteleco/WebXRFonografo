export function publicUrl(path: string): string {
  if (/^(?:\.\.?\/|https?:\/\/|data:)/.test(path)) {
    return path;
  }

  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `${import.meta.env.BASE_URL}${clean}`;
}
