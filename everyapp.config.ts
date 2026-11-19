import { defineEveryApp } from "@every-app/sdk";

// defineEveryApp types the manifest. The Gateway keeps it; the Worker gets
// the bindings it lists (env.DB), never the file.
export default defineEveryApp({
  id: "ftth-network-designer",
  name: "FTTH Network Designer",
  description:
    "Plan fiber-to-the-home networks on a map, wire each box fiber by fiber, and check every customer's optical power budget.",
  icon: "/icon.svg",
  access: "everyone",
  resources: {
    d1: ["DB"],
  },
});
