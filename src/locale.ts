export type Locale = "en" | "es";

const DEFAULT_LOCALE: Locale = "es";

let currentLocale: Locale = DEFAULT_LOCALE;

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function resolveLocalePath(path: string): string {
  return path.split("{locale}").join(currentLocale);
}
