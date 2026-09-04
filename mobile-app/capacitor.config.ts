import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.fazmeucontrole.mobile",
  appName: "RumoFi",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
