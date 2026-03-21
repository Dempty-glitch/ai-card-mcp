// Single source of truth: reads version from package.json at runtime
// No need to manually sync — just run `npm version patch` and publish
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const CURRENT_MCP_VERSION: string = require("../package.json").version;
