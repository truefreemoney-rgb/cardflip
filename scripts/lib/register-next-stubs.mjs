import { register } from "node:module";
register("./alias-loader.mjs", import.meta.url);
register("./next-stubs-loader.mjs", import.meta.url);
