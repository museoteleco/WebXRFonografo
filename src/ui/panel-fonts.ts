import { publicUrl } from "../assets/public-url.js";

export const PANEL_FONT_FAMILIES = {
  inter: {
    medium: publicUrl("./fonts/inter-medium.json"),
    "semi-bold": publicUrl("./fonts/inter-semibold.json"),
    bold: publicUrl("./fonts/inter-bold.json"),
    "600": publicUrl("./fonts/inter-semibold.json"),
    "700": publicUrl("./fonts/inter-bold.json"),
    "500": publicUrl("./fonts/inter-medium.json"),
  },
} as const;

const PANEL_FONT_ATLAS_URLS = [
  publicUrl("./fonts/inter-medium.png"),
  publicUrl("./fonts/inter-semibold.png"),
  publicUrl("./fonts/inter-bold.png"),
] as const;

const PANEL_FONT_JSON_URLS = [
  PANEL_FONT_FAMILIES.inter.medium,
  PANEL_FONT_FAMILIES.inter["semi-bold"],
  PANEL_FONT_FAMILIES.inter.bold,
] as const;

export function preloadPanelFonts(): Promise<void> {
  const jsonLoads = PANEL_FONT_JSON_URLS.map((url) =>
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null),
  );
  const atlasLoads = PANEL_FONT_ATLAS_URLS.map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = url;
      }),
  );
  return Promise.all([...jsonLoads, ...atlasLoads]).then(() => undefined);
}
