export function isHostedAcceptanceRequestAllowed(method, path) {
  const parts = path.split("/").filter(Boolean);
  const verb = method.toUpperCase();
  return (verb === "POST" && parts.join("/") === "udemy/cookies")
    || (verb === "GET" && parts.join("/") === "courses")
    || (verb === "POST" && parts.join("/") === "courses/import")
    || (verb === "GET" && parts.length === 2 && parts[0] === "courses" && /^\d+$/.test(parts[1]))
    || (verb === "GET" && parts.length === 2 && parts[0] === "jobs" && /^\d+$/.test(parts[1]))
    || (verb === "POST" && parts.join("/") === "subtitles/process");
}

export function hostedAcceptanceUserId({method,path,suppliedSecret,expectedSecret,userId}) {
  if (!expectedSecret || suppliedSecret !== expectedSecret || !userId || !isHostedAcceptanceRequestAllowed(method,path)) return null;
  return userId;
}
