declare const __RELEASE_COMMIT__: string;
export const releaseCommit = typeof __RELEASE_COMMIT__ === "string" ? __RELEASE_COMMIT__ : "development";
