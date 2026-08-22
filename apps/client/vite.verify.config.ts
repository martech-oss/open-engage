import { mergeConfig } from "vite";

import baseConfig from "./vite.config";

export default mergeConfig(baseConfig, {
  environments: {
    client: {
      build: {
        manifest: true,
      },
    },
  },
});
