import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Delta Flow",
    short_name: "Delta Flow",
    description: "Da criação à publicação, tudo em um único fluxo.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#0b0b0b",
    theme_color: "#171717",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
