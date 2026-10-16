import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../chatgpt-auth";

type Row = Record<string, any>;
type UserRow = { id: number; email: string; platform_user_id: string; is_active: number; drive_credentials: string | null };
type CookieBundle = { text: string; jar: Record<string, string>; businessDomain: string | null };
type Caption = Record<string, any>;

const UDEMY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const now = () => new Date().toISOString();
const db = () => {
  if (!env.DB) throw new Error("The Sites D1 database is not configured.");
  return env.DB;
};
const bucket = () => {
  if (!env.BUCKET) throw new Error("The Sites R2 bucket is not configured.");
  return env.BUCKET;
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function fail(detail: string, status = 400) {
  return json({ detail }, status);
}

async function bodyJson(request: Request): Promise<Row> {
  try { return await request.json() as Row; } catch { throw new ApiError(400, "Request body must be valid JSON."); }
}

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function currentUser(): Promise<UserRow> {
  const identity = await getChatGPTUser();
  if (!identity) throw new ApiError(401, "Sign in to ChatGPT to use this Site.");
  const database = db();
  await database.prepare(`INSERT INTO users (platform_user_id,email,is_active) VALUES (?,?,1)
    ON CONFLICT(platform_user_id) DO UPDATE SET email=excluded.email,updated_at=CURRENT_TIMESTAMP`)
    .bind(identity.userId, identity.email).run();
  const user = await database.prepare("SELECT * FROM users WHERE platform_user_id=? AND is_active=1")
    .bind(identity.userId).first<UserRow>();
  if (!user) throw new ApiError(401, "Your ChatGPT account is not active for this Site.");
  return user;
}

function safeInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function validUdemyUrl(raw: string) {
  const input = raw.trim();
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
  catch { throw new ApiError(400, "Invalid URL. Enter a Udemy course URL."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError(400, "Only Udemy course URLs are supported.");
  const host = url.hostname.toLowerCase();
  if (!(host === "udemy.com" || host.endsWith(".udemy.com"))) throw new ApiError(400, "Only udemy.com and Udemy Business subdomains are supported.");
  const match = url.pathname.match(/\/course\/([a-z0-9_-]+)/i);
  if (!match) throw new ApiError(400, "Could not identify a Udemy course in the URL.");
  const domain = host === "udemy.com" ? "www.udemy.com" : host;
  return { slug: match[1].toLowerCase(), url: `https://${domain}/course/${match[1].toLowerCase()}/`, domain };
}

function parseCookieText(raw: string): CookieBundle {
  if (!raw.trim()) throw new ApiError(400, "Cookie file is empty.");
  if (new TextEncoder().encode(raw).length > 2 * 1024 * 1024) throw new ApiError(400, "Cookie file exceeds the 2MB limit.");
  if (raw.includes("\0")) throw new ApiError(400, "Cookie file contains invalid binary content.");
  const jar: Record<string, string> = {};
  const lines: string[] = ["# Netscape HTTP Cookie File"];
  let businessDomain: string | null = null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Row | Row[];
      const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.cookies) ? parsed.cookies : [parsed];
      for (const cookie of entries) {
        if (!cookie || typeof cookie !== "object") continue;
        const domain = String(cookie.domain || "").trim();
        const cleanDomain = domain.replace(/^\./, "").toLowerCase();
        const name = String(cookie.name || "").trim();
        const value = String(cookie.value || "").trim();
        if (!name || !value || !isUdemyDomain(cleanDomain)) continue;
        jar[name] = value;
        if (cleanDomain.endsWith(".udemy.com") && !["udemy.com", "www.udemy.com"].includes(cleanDomain)) businessDomain = cleanDomain;
        const expires = Number(cookie.expirationDate || cookie.expires || 0);
        lines.push(`${domain}\t${cookie.hostOnly ? "FALSE" : "TRUE"}\t${cookie.path || "/"}\t${cookie.secure ? "TRUE" : "FALSE"}\t${Number.isFinite(expires) ? Math.trunc(expires) : 0}\t${name}\t${value}`);
      }
      if (Object.keys(jar).length) {
        if (businessDomain) lines.splice(1, 0, `# Udemy Business Domain: ${businessDomain}`);
        return { text: `${lines.join("\n")}\n`, jar, businessDomain };
      }
    } catch { /* Netscape parsing below returns the validation error. */ }
  }
  for (const source of raw.split(/\r?\n/)) {
    const line = source.trim();
    if (!line) continue;
    const commentDomain = line.match(/^#\s*Udemy Business Domain:\s*([a-z0-9_.-]+)/i)?.[1];
    if (commentDomain && isUdemyDomain(commentDomain)) businessDomain = commentDomain.toLowerCase();
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) {
      if (commentDomain) lines.push(`# Udemy Business Domain: ${commentDomain.toLowerCase()}`);
      continue;
    }
    const fields = line.replace(/^#HttpOnly_/, "").split("\t");
    if (fields.length < 7) continue;
    const [domainRaw, includeSubdomains, path, secure, expires, nameRaw, valueRaw] = fields;
    const domain = domainRaw.trim().replace(/^\./, "").toLowerCase();
    const name = nameRaw.trim();
    const value = valueRaw.trim();
    if (!name || !isUdemyDomain(domain)) continue;
    jar[name] = value;
    if (domain.endsWith(".udemy.com") && !["udemy.com", "www.udemy.com"].includes(domain)) businessDomain = domain;
    lines.push(`${domainRaw}\t${includeSubdomains}\t${path || "/"}\t${secure || "TRUE"}\t${expires || "0"}\t${name}\t${value}`);
  }
  if (!Object.keys(jar).length) throw new ApiError(400, "No valid Udemy cookies were found. Upload Netscape cookies.txt for udemy.com.");
  if (businessDomain) lines.splice(1, 0, `# Udemy Business Domain: ${businessDomain}`);
  return { text: `${lines.join("\n")}\n`, jar, businessDomain };
}

function isUdemyDomain(host: string) {
  const domain = host.trim().toLowerCase().replace(/^\./, "");
  return domain === "udemy.com" || domain.endsWith(".udemy.com");
}

function cookieHeader(jar: Record<string, string>) {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function encrypt(value: string) {
  const secret = (env as any).SECRET_KEY as string | undefined;
  if (!secret || secret.length < 32) throw new ApiError(503, "Site secret SECRET_KEY must be configured with at least 32 characters.");
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

async function decrypt(value: string) {
  const secret = (env as any).SECRET_KEY as string | undefined;
  if (!secret || secret.length < 32 || !value.startsWith("v1.")) throw new Error("Stored Udemy cookies could not be decrypted.");
  const [, ivPart, ciphertext] = value.split(".");
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", material, "AES-GCM", false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivPart) }, key, fromBase64(ciphertext));
  return new TextDecoder().decode(clear);
}

function toBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function getUdemySession(userId: number) {
  return db().prepare("SELECT * FROM udemy_sessions WHERE user_id=?").bind(userId).first<Row>();
}

async function getCookieBundle(userId: number): Promise<CookieBundle | null> {
  const session = await getUdemySession(userId);
  if (!session?.encrypted_cookie_data) return null;
  return parseCookieText(await decrypt(session.encrypted_cookie_data));
}

async function udemyFetch(url: string, jar: Record<string, string> = {}, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", UDEMY_UA);
  headers.set("Accept", "application/json, text/plain, */*");
  headers.set("Accept-Language", "en-US,en;q=0.9");
  if (Object.keys(jar).length) {
    headers.set("Cookie", cookieHeader(jar));
    if (jar.access_token) headers.set("Authorization", `Bearer ${jar.access_token}`);
  }
  const response = await fetch(url, { ...init, headers, redirect: "follow" });
  return response;
}

async function udemyValidation(jar: Record<string, string>, businessDomain: string | null) {
  const hosts = [...new Set([businessDomain, "www.udemy.com"].filter(Boolean) as string[])];
  let lastStatus = 0;
  for (const host of hosts) {
    try {
      const response = await udemyFetch(`https://${host}/api-2.0/users/me/`, jar);
      lastStatus = response.status;
      if (response.ok) {
        const user = await response.json() as Row;
        const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.display_name || user.email || null;
        return { status: "CONNECTED", accountName: name as string | null, error: null as string | null };
      }
      if (response.status === 403) return { status: "ACCESS_DENIED", accountName: null, error: "Udemy denied access to this session." };
      if (response.status === 401) return { status: "EXPIRED_SESSION", accountName: null, error: "Udemy session expired." };
    } catch {
      return { status: "INVALID_COOKIES", accountName: null, error: "Could not connect to Udemy from the Sites runtime." };
    }
  }
  return { status: lastStatus === 401 ? "EXPIRED_SESSION" : lastStatus === 403 ? "ACCESS_DENIED" : "INVALID_COOKIES", accountName: null, error: `Udemy returned HTTP ${lastStatus || "unknown"}.` };
}

function userProfile(user: UserRow, session: Row | null) {
  let businessDomain: string | null = null;
  if (session?.encrypted_cookie_data) {
    // The domain is stored as a non-secret status field for this purpose.
    businessDomain = session.business_domain ?? null;
  }
  return {
    id: user.id,
    email: user.email,
    is_active: Boolean(user.is_active),
    has_drive_connected: Boolean(user.drive_credentials),
    has_udemy_connected: Boolean(session?.encrypted_cookie_data),
    udemy_status: session?.status ?? "DISCONNECTED",
    udemy_account_name: session?.account_name ?? null,
    udemy_business_domain: businessDomain,
    created_at: user.created_at ?? now(),
  };
}

function replaceUdemyDomain(value: string, newDomain: string) {
  try {
    const url = new URL(value);
    if (isUdemyDomain(url.hostname)) url.hostname = newDomain;
    return url.toString();
  } catch { return value; }
}

async function saveUdemySession(user: UserRow, bundle: CookieBundle, validation: Row) {
  await db().prepare(`INSERT INTO udemy_sessions (user_id,encrypted_cookie_data,status,account_name,business_domain,error_message,last_validated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_cookie_data=excluded.encrypted_cookie_data,status=excluded.status,
    account_name=excluded.account_name,business_domain=excluded.business_domain,error_message=excluded.error_message,last_validated_at=excluded.last_validated_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(user.id, await encrypt(bundle.text), validation.status, validation.accountName, bundle.businessDomain, validation.error, now()).run();
  const target = bundle.businessDomain || "www.udemy.com";
  const courses = await db().prepare("SELECT id,url FROM courses WHERE user_id=?").bind(user.id).all<Row>();
  for (const course of courses.results) {
    await db().prepare("UPDATE courses SET url=? WHERE id=?").bind(replaceUdemyDomain(course.url, target), course.id).run();
    const lectures = await db().prepare("SELECT l.id,l.url FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=?").bind(course.id).all<Row>();
    for (const lecture of lectures.results) await db().prepare("UPDATE lectures SET url=? WHERE id=?").bind(replaceUdemyDomain(lecture.url, target), lecture.id).run();
  }
}

function udemyStatus(session: Row | null) {
  return {
    status: session?.status || "DISCONNECTED", account_name: session?.account_name ?? null,
    business_domain: session?.business_domain ?? null, last_validated_at: session?.last_validated_at ?? null,
    error_message: session?.error_message ?? null,
  };
}

async function udemyRoutes(request: Request, user: UserRow, path: string[], _url: URL) {
  const database = db();
  const session = await getUdemySession(user.id);
  if (path[0] === "status" && request.method === "GET") return json(udemyStatus(session));
  if (path[0] === "cookies" && request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    const text = String(form.get("cookie_text") || (file instanceof File ? await file.text() : ""));
    const bundle = parseCookieText(text);
    const validation = await udemyValidation(bundle.jar, bundle.businessDomain);
    await saveUdemySession(user, bundle, validation);
    return json(udemyStatus(await getUdemySession(user.id)));
  }
  if (path[0] === "test-connection" && request.method === "POST") {
    if (!session?.encrypted_cookie_data) throw new ApiError(400, "No Udemy cookies have been uploaded.");
    try {
      const bundle = await getCookieBundle(user.id);
      const validation = await udemyValidation(bundle!.jar, bundle!.businessDomain);
      await database.prepare("UPDATE udemy_sessions SET status=?,account_name=COALESCE(?,account_name),error_message=?,last_validated_at=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
        .bind(validation.status, validation.accountName, validation.error, now(), user.id).run();
    } catch {
      await database.prepare("UPDATE udemy_sessions SET status='INVALID_COOKIES',error_message=?,last_validated_at=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?")
        .bind("Stored Udemy cookies could not be decrypted.", now(), user.id).run();
    }
    return json(udemyStatus(await getUdemySession(user.id)));
  }
  if (path[0] === "sync-domains" && request.method === "POST") {
    const bundle = await getCookieBundle(user.id);
    if (!bundle) throw new ApiError(400, "No Udemy cookies found. Please upload cookies first.");
    const domain = bundle.businessDomain || "www.udemy.com";
    const courses = await database.prepare("SELECT id,url FROM courses WHERE user_id=?").bind(user.id).all<Row>();
    let coursesUpdated = 0, lecturesUpdated = 0;
    for (const course of courses.results) {
      const next = replaceUdemyDomain(course.url, domain);
      if (next !== course.url) { await database.prepare("UPDATE courses SET url=? WHERE id=?").bind(next, course.id).run(); coursesUpdated++; }
      const lectures = await database.prepare("SELECT l.id,l.url FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=?").bind(course.id).all<Row>();
      for (const lecture of lectures.results) {
        const lectureUrl = replaceUdemyDomain(lecture.url, domain);
        if (lectureUrl !== lecture.url) { await database.prepare("UPDATE lectures SET url=? WHERE id=?").bind(lectureUrl, lecture.id).run(); lecturesUpdated++; }
      }
    }
    return json({ status: "success", domain, courses_updated: coursesUpdated, lectures_updated: lecturesUpdated });
  }
  if (path[0] === "disconnect" && request.method === "POST") {
    await database.prepare(`UPDATE udemy_sessions SET encrypted_cookie_data=NULL,status='DISCONNECTED',account_name=NULL,error_message=NULL,
      business_domain=NULL,last_validated_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).bind(user.id).run();
    return json({ message: "Udemy session disconnected and cookies deleted successfully." });
  }
  return fail("Not found.", 404);
}

async function driveRoutes(request: Request, user: UserRow, path: string[], url: URL) {
  const configured = Boolean((env as any).GOOGLE_CLIENT_ID && (env as any).GOOGLE_CLIENT_SECRET);
  if (path[0] === "status" && request.method === "GET") return json({ is_configured: configured, is_connected: Boolean(user.drive_credentials) });
  if (path[0] === "auth-url" && request.method === "GET") {
    if (!configured) throw new ApiError(503, "Google Drive OAuth is not configured on this Site.");
    const state = crypto.randomUUID();
    await db().prepare("INSERT INTO oauth_states (state,user_id,expires_at) VALUES (?,?,?)")
      .bind(state, user.id, new Date(Date.now() + 10 * 60_000).toISOString()).run();
    const config = driveConfig(url.toString());
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [key, value] of Object.entries({ client_id: config.clientId!, redirect_uri: config.redirectUri, response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", include_granted_scopes: "true", prompt: "consent", state })) authUrl.searchParams.set(key, value);
    return json({ url: authUrl.toString() });
  }
  if (path[0] === "disconnect" && request.method === "POST") {
    await db().prepare("UPDATE users SET drive_credentials=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
    return json({ message: "Google Drive disconnected successfully." });
  }
  return fail("Not found.", 404);
}

async function driveCallback(request: Request, url: URL) {
  const error = url.searchParams.get("error");
  if (error) return Response.redirect(new URL(`/dashboard?drive_error=${encodeURIComponent("Google Drive authorization was cancelled or denied.")}`, url.origin), 302);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return Response.redirect(new URL(`/dashboard?drive_error=${encodeURIComponent("Google Drive state could not be verified.")}`, url.origin), 302);
  const database = db();
  const savedState = await database.prepare("SELECT * FROM oauth_states WHERE state=?").bind(state).first<Row>();
  await database.prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();
  if (!savedState || Date.parse(savedState.expires_at) < Date.now()) return Response.redirect(new URL(`/dashboard?drive_error=${encodeURIComponent("Google Drive authorization expired. Try again.")}`, url.origin), 302);
  const config = driveConfig(url.toString());
  if (!config.clientId || !config.clientSecret) return Response.redirect(new URL(`/dashboard?drive_error=${encodeURIComponent("Google Drive OAuth is not configured on this Site.")}`, url.origin), 302);
  const form = new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const token = await response.json() as Row;
  if (!response.ok || !token.access_token) return Response.redirect(new URL(`/dashboard?drive_error=${encodeURIComponent("Google Drive token exchange failed. Check the OAuth redirect URI.")}`, url.origin), 302);
  const user = await database.prepare("SELECT * FROM users WHERE id=?").bind(savedState.user_id).first<UserRow>();
  if (!user) return Response.redirect(new URL("/dashboard", url.origin), 302);
  const credentials = { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Date.now() + Number(token.expires_in || 3600) * 1000, scope: token.scope, token_type: token.token_type };
  await database.prepare("UPDATE users SET drive_credentials=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(credentials), user.id).run();
  return Response.redirect(new URL("/dashboard?drive_connected=true", url.origin), 302);
}

async function courseRoutes(request: Request, user: UserRow, path: string[], url: URL) {
  const database = db();
  if (path.length === 1 && path[0] === "import" && request.method === "POST") {
    const payload = await bodyJson(request);
    const normalized = validUdemyUrl(String(payload.url || ""));
    return json(await ensureJob(user.id, "COURSE_IMPORT", null, { url: normalized.url }, 1), 202);
  }
  if (path.length === 1 && request.method === "GET") {
    const page = safeInt(url.searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = safeInt(url.searchParams.get("page_size"), 20, 1, 100);
    const search = (url.searchParams.get("search") || "").trim();
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const query = search ? "SELECT * FROM courses WHERE user_id=? AND title LIKE ? ESCAPE '\\'" : "SELECT * FROM courses WHERE user_id=?";
    const bind = search ? [user.id, term] : [user.id];
    const total = await database.prepare(search ? "SELECT COUNT(*) AS total FROM courses WHERE user_id=? AND title LIKE ? ESCAPE '\\'" : "SELECT COUNT(*) AS total FROM courses WHERE user_id=?").bind(...bind).first<Row>();
    const rows = await database.prepare(`${query} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...bind, pageSize, (page - 1) * pageSize).all<Row>();
    const items = await Promise.all(rows.results.map((course) => courseRead(course, false)));
    return json({ items, total: Number(total?.total || 0) });
  }
  if (path[0] === "lectures" && path.length === 2 && request.method === "PATCH") {
    const lectureId = Number(path[1]);
    const lecture = await ownedLecture(user.id, lectureId);
    const payload = await bodyJson(request);
    const fields: string[] = [], values: any[] = [];
    if (payload.learning_status !== undefined && payload.learning_status !== null) {
      const raw = String(payload.learning_status).trim().toUpperCase();
      const statuses: Record<string, string> = { TO_DO: "NOT_STARTED", "TO DO": "NOT_STARTED", NOT_STARTED: "NOT_STARTED", DOING: "IN_PROGRESS", IN_PROGRESS: "IN_PROGRESS", DONE: "COMPLETED", COMPLETED: "COMPLETED" };
      if (!statuses[raw]) throw new ApiError(400, "Invalid learning status. Must be To do, Doing, or Done.");
      fields.push("learning_status=?"); values.push(statuses[raw]);
    }
    if (payload.chatgpt_url !== undefined && payload.chatgpt_url !== null) {
      const value = String(payload.chatgpt_url).trim();
      if (value) {
        let parsed: URL; try { parsed = new URL(value); } catch { throw new ApiError(400, "Invalid URL format."); }
        if (!["chatgpt.com", "chat.openai.com"].includes(parsed.hostname.toLowerCase())) throw new ApiError(400, "URL must point to ChatGPT (chatgpt.com or chat.openai.com).");
      }
      fields.push("chatgpt_url=?"); values.push(value || null);
    }
    if (fields.length) await database.prepare(`UPDATE lectures SET ${fields.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...values, lectureId).run();
    const updated = await database.prepare("SELECT * FROM lectures WHERE id=?").bind(lectureId).first<Row>();
    const subs = await database.prepare("SELECT * FROM subtitles WHERE lecture_id=?").bind(lectureId).all<Row>();
    return json(lectureRead(updated!, subs.results));
  }
  const id = Number(path[0]);
  if (!Number.isInteger(id) || id <= 0) return fail("Not found.", 404);
  if (path.length === 2 && path[1] === "sync" && request.method === "POST") {
    const course = await ownedCourse(user.id, id);
    return json(await ensureJob(user.id, "COURSE_IMPORT", id, { url: course.url }, 1), 202);
  }
  if (path.length === 1 && request.method === "GET") return json(await courseRead(await ownedCourse(user.id, id), true));
  if (path.length === 1 && request.method === "DELETE") {
    const course = await ownedCourse(user.id, id);
    const credentials = await normalizeDriveCredentials(user);
    if (credentials) {
      const subs = await database.prepare(`SELECT sub.drive_file_id,sub.storage_key FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id WHERE s.course_id=?`).bind(id).all<Row>();
      for (const sub of subs.results) {
        if (sub.drive_file_id) await deleteDriveFile(user, credentials, sub.drive_file_id).catch(() => undefined);
        if (sub.storage_key) await bucket().delete(sub.storage_key).catch(() => undefined);
      }
    } else {
      const subs = await database.prepare(`SELECT sub.storage_key FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id WHERE s.course_id=?`).bind(id).all<Row>();
      for (const sub of subs.results) if (sub.storage_key) await bucket().delete(sub.storage_key).catch(() => undefined);
    }
    await database.prepare("DELETE FROM courses WHERE id=? AND user_id=?").bind(id, user.id).run();
    return json({ message: `Course '${course.title}' and associated subtitles deleted successfully.` });
  }
  return fail("Not found.", 404);
}

async function subtitleRoutes(request: Request, user: UserRow, path: string[], _url: URL) {
  const database = db();
  if (path[0] === "process" && path.length === 1 && request.method === "POST") {
    const payload = await bodyJson(request);
    const language = String(payload.language || "en");
    let rows: Row[] = [];
    if (Array.isArray(payload.lecture_ids) && payload.lecture_ids.length) {
      const ids = payload.lecture_ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0).slice(0, 250);
      if (!ids.length) throw new ApiError(400, "No eligible video lectures found to process.");
      const marks = ids.map(() => "?").join(",");
      rows = (await database.prepare(`SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE l.id IN (${marks}) AND c.user_id=? AND l.lecture_type='video'`).bind(...ids, user.id).all<Row>()).results;
    } else if (payload.section_id) {
      rows = (await database.prepare("SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE s.id=? AND c.user_id=? AND l.lecture_type='video' ORDER BY l.position").bind(Number(payload.section_id), user.id).all<Row>()).results;
    } else if (payload.course_id) {
      rows = (await database.prepare("SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE c.id=? AND c.user_id=? AND l.lecture_type='video' ORDER BY s.position,l.position").bind(Number(payload.course_id), user.id).all<Row>()).results;
    }
    if (!rows.length) throw new ApiError(400, "No eligible video lectures found to process.");
    return json(await ensureJob(user.id, "SUBTITLE_BATCH", payload.course_id ? Number(payload.course_id) : null,
      { lecture_ids: rows.map((row) => Number(row.id)), language, cursor: 0 }, rows.length), 202);
  }
  if (path[0] === "lectures" && path[2] === "process" && path.length === 3 && request.method === "POST") {
    const lectureId = Number(path[1]);
    const lecture = await ownedLecture(user.id, lectureId);
    return json(await ensureJob(user.id, "SUBTITLE_BATCH", Number(lecture.course_id), { lecture_ids: [lectureId], language: _url.searchParams.get("language") || "en", cursor: 0 }, 1), 202);
  }
  if (path[0] === "lectures" && path[2] === "upload" && path.length === 3 && request.method === "POST") {
    const lectureId = Number(path[1]);
    const lecture = await ownedLecture(user.id, lectureId);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "A .vtt or .srt file is required.");
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new ApiError(400, "File cannot be empty or larger than 5MB.");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "vtt" && ext !== "srt") throw new ApiError(400, "Unsupported subtitle format. Only .vtt and .srt are supported.");
    const language = String(form.get("language") || "en");
    const content = ext === "srt" ? srtToVtt(await file.text()) : normalizeVtt(await file.text());
    const subtitle = await storeSubtitle(user, lecture, language, content, "IMPORTED");
    const credentials = await normalizeDriveCredentials(user);
    let message = "Subtitle imported and stored successfully.";
    if (credentials) {
      try {
        const upload = await driveUpload(user, credentials, `${String(lecture.position).padStart(3, "0")} - ${lecture.title}.vtt`, content,
          [driveConfig().folderName, safeDriveName(lecture.course_title), `Section ${String(lecture.section_position).padStart(2, "0")} - ${safeDriveName(lecture.section_title)}`]);
        await database.prepare("UPDATE subtitles SET drive_file_id=?,drive_file_url=? WHERE id=?").bind(upload.id, upload.url, subtitle!.id).run();
      } catch (error) {
        await database.prepare("UPDATE subtitles SET error_message=?,error_category='DRIVE_ERROR' WHERE id=?").bind(`Saved to Site storage. Drive upload failed: ${error instanceof Error ? error.message : "unknown error"}`, subtitle!.id).run();
        message = "Subtitle saved to Site storage, but Google Drive upload failed.";
      }
    }
    const latest = await database.prepare("SELECT * FROM subtitles WHERE id=?").bind(subtitle!.id).first<Row>();
    return json({ subtitle: subtitleRead(latest!), message });
  }
  if (path[0] === "lectures" && path.length === 2 && request.method === "DELETE") {
    const lectureId = Number(path[1]);
    await ownedLecture(user.id, lectureId);
    const subs = await database.prepare("SELECT * FROM subtitles WHERE lecture_id=?").bind(lectureId).all<Row>();
    const credentials = await normalizeDriveCredentials(user);
    for (const sub of subs.results) {
      if (sub.drive_file_id && credentials) await deleteDriveFile(user, credentials, sub.drive_file_id).catch(() => undefined);
      if (sub.storage_key) await bucket().delete(sub.storage_key).catch(() => undefined);
    }
    await database.prepare("DELETE FROM subtitles WHERE lecture_id=?").bind(lectureId).run();
    return json({ message: "Subtitles deleted successfully for lecture.", lecture_id: lectureId });
  }
  const id = Number(path[0]);
  if (Number.isInteger(id) && id > 0 && path.length === 1 && request.method === "DELETE") {
    const subtitle = await database.prepare(`SELECT sub.* FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE sub.id=? AND c.user_id=?`).bind(id, user.id).first<Row>();
    if (!subtitle) throw new ApiError(404, "Subtitle not found.");
    const credentials = await normalizeDriveCredentials(user);
    if (subtitle.drive_file_id && credentials) await deleteDriveFile(user, credentials, subtitle.drive_file_id).catch(() => undefined);
    if (subtitle.storage_key) await bucket().delete(subtitle.storage_key).catch(() => undefined);
    await database.prepare("DELETE FROM subtitles WHERE id=?").bind(id).run();
    return json({ message: "Subtitle deleted successfully.", id });
  }
  if (Number.isInteger(id) && id > 0 && path[1] === "content" && request.method === "GET") {
    const subtitle = await database.prepare(`SELECT sub.* FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE sub.id=? AND c.user_id=?`).bind(id, user.id).first<Row>();
    if (!subtitle?.storage_key) throw new ApiError(404, "Subtitle file not found.");
    const object = await bucket().get(subtitle.storage_key);
    if (!object) throw new ApiError(404, "Subtitle file not found.");
    return new Response(object.body, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Content-Disposition": `attachment; filename="subtitle-${id}.vtt"`, "Cache-Control": "private, no-store" } });
  }
  return fail("Not found.", 404);
}

async function jobRoutes(request: Request, user: UserRow, path: string[], url: URL) {
  const database = db();
  if (!path.length && request.method === "GET") {
    await processPendingJob(user.id);
    const courseId = Number(url.searchParams.get("course_id") || 0);
    const limit = safeInt(url.searchParams.get("limit"), 10, 1, 50);
    const rows = courseId
      ? await database.prepare("SELECT * FROM processing_jobs WHERE user_id=? AND course_id=? ORDER BY created_at DESC,id DESC LIMIT ?").bind(user.id, courseId, limit).all<Row>()
      : await database.prepare("SELECT * FROM processing_jobs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?").bind(user.id, limit).all<Row>();
    return json(rows.results.map(jobRead));
  }
  const id = Number(path[0]);
  if (!Number.isInteger(id) || id <= 0) return fail("Not found.", 404);
  let job = await database.prepare("SELECT * FROM processing_jobs WHERE id=? AND user_id=?").bind(id, user.id).first<Row>();
  if (!job) throw new ApiError(404, "Job not found.");
  if (path.length === 1 && request.method === "GET") {
    await processPendingJob(user.id);
    job = await database.prepare("SELECT * FROM processing_jobs WHERE id=? AND user_id=?").bind(id, user.id).first<Row>();
    return json(jobRead(job!));
  }
  if (path.length === 2 && path[1] === "cancel" && request.method === "POST") {
    if (!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
      await database.prepare("UPDATE processing_jobs SET status='CANCELLED',progress_message='Cancellation requested.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
        .bind(id, user.id).run();
      job = await database.prepare("SELECT * FROM processing_jobs WHERE id=? AND user_id=?").bind(id, user.id).first<Row>();
    }
    return json(jobRead(job!));
  }
  return fail("Not found.", 404);
}

async function ensureJob(userId: number, jobType: string, courseId: number | null, payload: Row, totalItems: number) {
  const result = await db().prepare(`INSERT INTO processing_jobs (user_id,course_id,job_type,status,total_items,payload_json,progress_message)
    VALUES (?,?,?,'PENDING',?,?,?)`).bind(userId, courseId, jobType, totalItems, JSON.stringify(payload), "Queued for processing.").run();
  const id = Number(result.meta.last_row_id);
  const row = await db().prepare("SELECT * FROM processing_jobs WHERE id=?").bind(id).first<Row>();
  return jobRead(row!);
}

function jobRead(row: Row) {
  return {
    id: Number(row.id), user_id: Number(row.user_id), course_id: row.course_id == null ? null : Number(row.course_id),
    job_type: row.job_type, status: row.status, total_items: Number(row.total_items),
    completed_items: Number(row.completed_items), failed_items: Number(row.failed_items),
    progress_message: row.progress_message ?? null, error_message: row.error_message ?? null,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function subtitleRead(row: Row) {
  return {
    id: Number(row.id), lecture_id: Number(row.lecture_id), language: row.language,
    subtitle_type: row.subtitle_type, status: row.status, drive_file_id: row.drive_file_id ?? null,
    drive_file_url: row.drive_file_url ?? null, error_message: row.error_message ?? null,
    error_category: row.error_category ?? null, last_processed_at: row.last_processed_at ?? null,
  };
}

function lectureRead(row: Row, subtitleRows: Row[] = []) {
  return {
    id: Number(row.id), section_id: Number(row.section_id), lecture_id: String(row.lecture_id),
    title: row.title, url: row.url, lecture_type: row.lecture_type, duration: Number(row.duration || 0),
    position: Number(row.position), learning_status: row.learning_status, chatgpt_url: row.chatgpt_url ?? null,
    subtitles: subtitleRows.map(subtitleRead),
  };
}

async function courseRead(course: Row, includeSections = false) {
  const database = db();
  const sectionsRows = await database.prepare("SELECT * FROM sections WHERE course_id=? ORDER BY position,id").bind(course.id).all<Row>();
  const sectionsData = [];
  let totalLectures = 0, completedLectures = 0, processedSubtitles = 0, failedSubtitles = 0;
  const orderedLectures: Row[] = [];
  for (const section of sectionsRows.results) {
    const lecturesRows = await database.prepare("SELECT * FROM lectures WHERE section_id=? ORDER BY position,id").bind(section.id).all<Row>();
    totalLectures += lecturesRows.results.length;
    for (const lecture of lecturesRows.results) {
      orderedLectures.push(lecture);
      if (lecture.learning_status === "COMPLETED") completedLectures++;
      const subs = await database.prepare("SELECT * FROM subtitles WHERE lecture_id=?").bind(lecture.id).all<Row>();
      processedSubtitles += subs.results.filter((sub) => sub.status === "COMPLETED").length;
      failedSubtitles += subs.results.filter((sub) => sub.status === "FAILED").length;
      if (includeSections) (lecture as any).__subtitles = subs.results;
    }
    sectionsData.push({
      id: Number(section.id), course_id: Number(section.course_id), title: section.title,
      position: Number(section.position),
      ...(includeSections ? { lectures: lecturesRows.results.map((lec) => lectureRead(lec, (lec as any).__subtitles ?? [])) } : {}),
    });
  }
  const nextLecture = orderedLectures.find((lecture) => lecture.learning_status === "IN_PROGRESS")
    ?? orderedLectures.find((lecture) => lecture.learning_status === "NOT_STARTED");
  const nextSubtitles = nextLecture
    ? await database.prepare("SELECT * FROM subtitles WHERE lecture_id=?").bind(nextLecture.id).all<Row>()
    : { results: [] as Row[] };
  return {
    id: Number(course.id), course_id: String(course.course_id), title: course.title, url: course.url,
    instructor: course.instructor ?? null, thumbnail_url: course.thumbnail_url ?? null,
    total_sections: sectionsRows.results.length, total_lectures: totalLectures,
    completed_lectures: completedLectures, processed_subtitles: processedSubtitles,
    failed_subtitles: failedSubtitles, next_lecture: nextLecture ? lectureRead(nextLecture, nextSubtitles.results) : null,
    last_synced_at: course.last_synced_at, created_at: course.created_at,
    ...(includeSections ? { sections: sectionsData } : {}),
  };
}

async function ownedCourse(userId: number, id: number) {
  const course = await db().prepare("SELECT * FROM courses WHERE id=? AND user_id=?").bind(id, userId).first<Row>();
  if (!course) throw new ApiError(404, "Course not found.");
  return course;
}

async function ownedLecture(userId: number, id: number) {
  const lecture = await db().prepare(`SELECT l.*,s.course_id,c.user_id,c.title AS course_title,c.url AS course_url,s.title AS section_title,s.position AS section_position
    FROM lectures l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id
    WHERE l.id=? AND c.user_id=?`).bind(id, userId).first<Row>();
  if (!lecture) throw new ApiError(404, "Lecture not found.");
  return lecture;
}

async function normalizeDriveCredentials(user: UserRow) {
  if (!user.drive_credentials) return null;
  try { return JSON.parse(user.drive_credentials) as Row; } catch { return null; }
}

function driveConfig(requestUrl?: string) {
  const config = env as any;
  return {
    clientId: config.GOOGLE_CLIENT_ID as string | undefined,
    clientSecret: config.GOOGLE_CLIENT_SECRET as string | undefined,
    redirectUri: config.GOOGLE_REDIRECT_URI as string | undefined
      || (requestUrl ? `${new URL(requestUrl).origin}/api/drive/callback` : ""),
    folderName: config.GOOGLE_DRIVE_FOLDER_NAME as string | undefined || "Udemy Subtitles",
  };
}

async function driveAccessToken(user: UserRow, credentials: Row) {
  const config = driveConfig();
  if (credentials.access_token && Number(credentials.expires_at || 0) > Date.now() + 60_000) return credentials.access_token as string;
  if (!credentials.refresh_token || !config.clientId || !config.clientSecret) throw new ApiError(401, "Google Drive authorization expired. Reconnect Drive.");
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: credentials.refresh_token, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json() as Row;
  if (!response.ok || !data.access_token) throw new ApiError(401, "Google Drive token refresh failed. Reconnect Drive.");
  const next = { ...credentials, access_token: data.access_token, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
  await db().prepare("UPDATE users SET drive_credentials=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(next), user.id).run();
  credentials.access_token = next.access_token;
  credentials.expires_at = next.expires_at;
  return next.access_token as string;
}

async function driveRequest(user: UserRow, credentials: Row, url: string, init: RequestInit = {}) {
  const token = await driveAccessToken(user, credentials);
  const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new ApiError(response.status, `Google Drive returned HTTP ${response.status}.`);
  return response;
}

function safeDriveName(value: string) {
  return (value || "Untitled").replace(/[\\/*?:"<>|\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "") || "Untitled";
}

async function getOrCreateDriveFolder(user: UserRow, credentials: Row, name: string, parentId?: string) {
  const q = [`mimeType='application/vnd.google-apps.folder'`, `name='${safeDriveName(name).replace(/'/g, "\\'")}'`, "trashed=false"];
  if (parentId) q.push(`'${parentId}' in parents`);
  const params = new URLSearchParams({ q: q.join(" and "), spaces: "drive", fields: "files(id,name)", pageSize: "10" });
  const found = await driveRequest(user, credentials, `https://www.googleapis.com/drive/v3/files?${params}`);
  const result = await found.json() as Row;
  if (result.files?.[0]?.id) return result.files[0].id as string;
  const created = await driveRequest(user, credentials, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: safeDriveName(name), mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return (await created.json() as Row).id as string;
}

async function driveFolder(user: UserRow, credentials: Row, hierarchy: string[]) {
  let parent: string | undefined;
  for (const name of hierarchy.filter(Boolean)) parent = await getOrCreateDriveFolder(user, credentials, name, parent);
  return parent;
}

async function driveUpload(user: UserRow, credentials: Row, name: string, content: string, hierarchy: string[]) {
  const parent = await driveFolder(user, credentials, hierarchy);
  const metadata = { name: safeDriveName(name), ...(parent ? { parents: [parent] } : {}) };
  const boundary = `udemy-${crypto.randomUUID()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/vtt\r\n\r\n${content}\r\n--${boundary}--`;
  const response = await driveRequest(user, credentials, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  const uploaded = await response.json() as Row;
  if (!uploaded.id) throw new ApiError(502, "Google Drive did not confirm the subtitle upload.");
  return { id: String(uploaded.id), url: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view` };
}

async function deleteDriveFile(user: UserRow, credentials: Row, fileId: string) {
  const token = await driveAccessToken(user, credentials);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 404) throw new ApiError(response.status, `Google Drive returned HTTP ${response.status}.`);
}

async function storeSubtitle(user: UserRow, lecture: Row, language: string, content: string, type: string) {
  const key = `${user.id}/${lecture.course_id}/${lecture.lecture_id}/${encodeURIComponent(language)}.vtt`;
  await bucket().put(key, content, { httpMetadata: { contentType: "text/vtt; charset=utf-8" } });
  const existing = await db().prepare("SELECT * FROM subtitles WHERE lecture_id=? AND language=?").bind(lecture.id, language).first<Row>();
  if (existing) {
    await db().prepare(`UPDATE subtitles SET subtitle_type=?,status='COMPLETED',storage_key=?,error_message=NULL,error_category=NULL,last_processed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(type, key, now(), existing.id).run();
    return await db().prepare("SELECT * FROM subtitles WHERE id=?").bind(existing.id).first<Row>();
  }
  const insert = await db().prepare(`INSERT INTO subtitles (lecture_id,language,subtitle_type,status,storage_key,last_processed_at)
    VALUES (?,?,?,'COMPLETED',?,?)`).bind(lecture.id, language, type, key, now()).run();
  return await db().prepare("SELECT * FROM subtitles WHERE id=?").bind(insert.meta.last_row_id).first<Row>();
}

function srtToVtt(input: string) {
  const normalized = input.replace(/\r\n?/g, "\n").trim().replace(/(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2 --> $3.$4");
  return `${normalized.startsWith("WEBVTT") ? "" : "WEBVTT\n\n"}${normalized}\n`;
}

function normalizeVtt(value: string) {
  const clean = value.replace(/^\uFEFF/, "").trim();
  return `${clean.startsWith("WEBVTT") ? "" : "WEBVTT\n\n"}${clean}\n`;
}

function chooseCaption(captions: Caption[], language: string) {
  const base = language.toLowerCase().split(/[-_]/)[0];
  const matches = captions.filter((caption) => {
    const locale = String(caption.locale_id || caption.lang || caption.language || caption.language_code || "").toLowerCase();
    return locale === language.toLowerCase() || locale.split(/[-_]/)[0] === base;
  });
  const isAuto = (caption: Caption) => /auto|generated|automatic/i.test(`${caption.source || ""} ${caption.type || ""} ${caption.label || ""} ${caption.title || ""}`);
  return { caption: matches.find((item) => !isAuto(item)) || matches.find(isAuto) || null,
    type: matches.some((item) => !isAuto(item)) ? "MANUAL" : matches.length ? "AUTO" : "NONE" };
}

async function subtitleContent(lecture: Row, language: string, cookies: CookieBundle | null) {
  let captions: Caption[] = [];
  try { captions = JSON.parse(lecture.captions_json || "[]") as Caption[]; } catch { captions = []; }
  if (!captions.length && cookies) {
    const host = new URL(lecture.course_url).hostname;
    const url = new URL(`https://${host}/api-2.0/users/me/subscribed-courses/${lecture.course_id}/lectures/${lecture.lecture_id}/`);
    url.searchParams.set("fields[lecture]", "title,asset,transcript"); url.searchParams.set("fields[asset]", "@all");
    const response = await udemyFetch(url.toString(), cookies.jar);
    if (response.ok) {
      const data = await response.json() as Row;
      captions = data.asset?.captions || data.asset?.subtitles || [];
      if (captions.length) await db().prepare("UPDATE lectures SET captions_json=? WHERE id=?").bind(JSON.stringify(captions), lecture.id).run();
    }
  }
  const selected = chooseCaption(captions, language);
  const captionUrl = selected.caption?.url || selected.caption?.download_url;
  if (!captionUrl) return { error: "No subtitles found for this lecture.", category: "NO_SUBTITLES" };
  const parsedUrl = new URL(captionUrl);
  if (parsedUrl.protocol !== "https:") return { error: "Udemy returned an unsafe caption URL.", category: "CAPTION_ERROR" };
  const response = await udemyFetch(parsedUrl.toString(), cookies?.jar || {});
  if (!response.ok) return { error: `Caption download returned HTTP ${response.status}.`, category: response.status === 403 ? "ACCESS_DENIED" : "CAPTION_ERROR" };
  const content = normalizeVtt(await response.text());
  const finalLanguage = String(selected.caption?.locale_id || selected.caption?.lang || selected.caption?.language || language);
  return { content, type: selected.type, language: finalLanguage };
}

async function processSubtitle(user: UserRow, lecture: Row, language: string) {
  const database = db();
  const cookies = await getCookieBundle(user.id).catch(() => null);
  const record = await database.prepare("SELECT * FROM subtitles WHERE lecture_id=? AND language=?").bind(lecture.id, language).first<Row>();
  if (lecture.lecture_type !== "video") {
    if (record) await database.prepare("UPDATE subtitles SET status='NO_SUBTITLES',subtitle_type='NONE',error_category='UNSUPPORTED_TYPE',error_message=?,last_processed_at=? WHERE id=?").bind("Lecture is not a video.", now(), record.id).run();
    else await database.prepare("INSERT INTO subtitles (lecture_id,language,subtitle_type,status,error_category,error_message,last_processed_at) VALUES (?,?,'NONE','NO_SUBTITLES','UNSUPPORTED_TYPE',?,?)").bind(lecture.id, language, "Lecture is not a video.", now()).run();
    return false;
  }
  let result: Row;
  try { result = await subtitleContent(lecture, language, cookies); }
  catch (error) { result = { error: error instanceof Error ? error.message : "Subtitle retrieval failed.", category: "PROCESSING_ERROR" }; }
  if (!result.content) {
    const category = result.category === "NO_SUBTITLES" ? "NO_SUBTITLES" : "FAILED";
    if (record) await database.prepare("UPDATE subtitles SET status=?,subtitle_type='NONE',error_category=?,error_message=?,last_processed_at=? WHERE id=?").bind(category, result.category, result.error, now(), record.id).run();
    else await database.prepare("INSERT INTO subtitles (lecture_id,language,subtitle_type,status,error_category,error_message,last_processed_at) VALUES (?,?,'NONE',?,?,?,?)").bind(lecture.id, language, category, result.category, result.error, now()).run();
    return false;
  }
  const subtitle = await storeSubtitle(user, lecture, result.language, result.content, result.type);
  const credentials = await normalizeDriveCredentials(user);
  if (credentials) {
    try {
      const uploaded = await driveUpload(user, credentials, `${String(lecture.position).padStart(3, "0")} - ${lecture.title}.vtt`, result.content,
        [driveConfig().folderName, safeDriveName(lecture.course_title), `Section ${String(lecture.section_position).padStart(2, "0")} - ${safeDriveName(lecture.section_title)}`]);
      await database.prepare("UPDATE subtitles SET drive_file_id=?,drive_file_url=?,error_message=NULL,error_category=NULL WHERE id=?").bind(uploaded.id, uploaded.url, subtitle.id).run();
    } catch (error) {
      await database.prepare("UPDATE subtitles SET error_message=?,error_category='DRIVE_ERROR' WHERE id=?").bind(`Saved to Site storage. Drive upload failed: ${error instanceof Error ? error.message : "unknown error"}`, subtitle.id).run();
    }
  }
  return true;
}

async function processPendingJob(userId: number) {
  const database = db();
  const job = await database.prepare("SELECT * FROM processing_jobs WHERE user_id=? AND status IN ('PENDING','PROCESSING') ORDER BY created_at,id LIMIT 1").bind(userId).first<Row>();
  if (!job) return;
  const payload = JSON.parse(job.payload_json || "{}");
  await database.prepare("UPDATE processing_jobs SET status='PROCESSING',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.id).run();
  if (job.job_type === "COURSE_IMPORT") {
    await importCourseJob(job, payload);
    return;
  }
  if (job.job_type !== "SUBTITLE_BATCH") return;
  const ids: number[] = payload.lecture_ids || [];
  const cursor = Number(payload.cursor || 0);
  if (cursor >= ids.length) {
    await database.prepare("UPDATE processing_jobs SET status='COMPLETED',progress_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(`Batch completed: ${job.completed_items} succeeded, ${job.failed_items} failed or had no subtitles.`, job.id).run();
    return;
  }
  const user = await database.prepare("SELECT * FROM users WHERE id=?").bind(userId).first<UserRow>();
  const lecture = await ownedLecture(userId, ids[cursor]).catch(() => null);
  let succeeded = false;
  if (user && lecture) {
    try { succeeded = await processSubtitle(user, lecture, payload.language || "en"); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "Subtitle processing failed.";
      const existing = await database.prepare("SELECT id FROM subtitles WHERE lecture_id=? AND language=?").bind(lecture.id, payload.language || "en").first<Row>();
      if (existing) await database.prepare("UPDATE subtitles SET status='FAILED',error_category='PROCESSING_ERROR',error_message=?,last_processed_at=? WHERE id=?").bind(detail, now(), existing.id).run();
      else await database.prepare("INSERT INTO subtitles (lecture_id,language,subtitle_type,status,error_category,error_message,last_processed_at) VALUES (?,?,'NONE','FAILED','PROCESSING_ERROR',?,?)").bind(lecture.id, payload.language || "en", detail, now()).run();
    }
  }
  const next = cursor + 1;
  const finished = next >= ids.length;
  await database.prepare(`UPDATE processing_jobs SET completed_items=completed_items+?,failed_items=failed_items+?,payload_json=?,status=?,progress_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(succeeded ? 1 : 0, succeeded ? 0 : 1, JSON.stringify({ ...payload, cursor: next }), finished ? "COMPLETED" : "PROCESSING",
      finished ? `Batch completed: ${Number(job.completed_items) + Number(succeeded)} succeeded, ${Number(job.failed_items) + Number(!succeeded)} failed or had no subtitles.` : `Processing (${next}/${ids.length}): ${lecture?.title || "lecture"}`, job.id).run();
}

async function apiUserProfile(user: UserRow) {
  return userProfile(user, await getUdemySession(user.id));
}

async function readCourseApi(url: string, jar: Record<string, string>) {
  const response = await udemyFetch(url, jar);
  if (!response.ok) throw new ApiError(response.status === 404 ? 404 : response.status === 401 ? 401 : response.status === 403 ? 403 : 502,
    response.status === 401 ? "Udemy session expired or is not enrolled in this course." : response.status === 403 ? "Udemy denied access to this course." : `Udemy returned HTTP ${response.status}.`);
  return response.json() as Promise<Row>;
}

async function importCourseJob(job: Row, payload: Row) {
  const database = db();
  try {
    const parsed = validUdemyUrl(payload.url);
    const session = await getUdemySession(Number(job.user_id));
    const cookies = session?.encrypted_cookie_data ? await getCookieBundle(Number(job.user_id)) : null;
    const domain = cookies?.businessDomain || parsed.domain;
    const courseFields = new URLSearchParams({ "fields[course]": "id,title,headline,image_480x270,visible_instructors,url" });
    let details: Row;
    try { details = await readCourseApi(`https://${domain}/api-2.0/courses/${encodeURIComponent(parsed.slug)}/?${courseFields}`, cookies?.jar || {}); }
    catch (error) {
      if (domain === "www.udemy.com") throw error;
      details = await readCourseApi(`https://www.udemy.com/api-2.0/courses/${encodeURIComponent(parsed.slug)}/?${courseFields}`, cookies?.jar || {});
    }
    const courseId = String(details.id);
    const canonicalUrl = details.url?.startsWith("/") ? `https://${domain}${details.url}` : parsed.url;
    const instructor = details.visible_instructors?.[0]?.display_name || null;
    const curriculum: Row[] = [];
    const hosts = [...new Set([domain, "www.udemy.com"] as string[])];
    for (const host of hosts) {
      for (const endpointName of [...(cookies ? ["subscriber-curriculum-items"] : []), "public-curriculum-items"]) {
        let next: string | null = `https://${host}/api-2.0/courses/${courseId}/${endpointName}/`;
        let first = true;
        const params = new URLSearchParams({ page_size: "100", "fields[lecture]": "title,object_index,asset,sort_order", "fields[asset]": "title,asset_type,time_estimation,length,captions" });
        for (let page = 0; next && page < 30; page++) {
          const target = new URL(next);
          if (first) for (const [key, value] of params) target.searchParams.set(key, value);
          const response = await udemyFetch(target.toString(), cookies?.jar || {});
          if (!response.ok) break;
          const data = await response.json() as Row;
          curriculum.push(...(data.results || [])); next = data.next || null; first = false;
        }
        if (curriculum.length) break;
      }
      if (curriculum.length) break;
    }
    const sections: Row[] = [];
    let current: Row = { title: "Introduction", lectures: [] };
    for (const item of curriculum) {
      if (item._class === "chapter") {
        if (current.lectures.length) sections.push(current);
        current = { title: item.title || `Section ${sections.length + 1}`, lectures: [] };
      } else if (item._class === "lecture") {
        const asset = item.asset || {};
        const type = String(asset.asset_type || item.asset_type || "video").toLowerCase().includes("video") ? "video" : "article";
        current.lectures.push({ id: String(item.id), title: item.title || `Lecture ${current.lectures.length + 1}`, type,
          duration: Number(asset.time_estimation || item.time_estimation || asset.length || 0), captions: asset.captions || asset.subtitles || [] });
      }
    }
    if (current.lectures.length) sections.push(current);
    const existing = await database.prepare("SELECT id FROM courses WHERE user_id=? AND course_id=?").bind(job.user_id, courseId).first<Row>();
    let localCourseId: number;
    if (existing) {
      localCourseId = Number(existing.id);
      await database.prepare("UPDATE courses SET title=?,url=?,instructor=?,thumbnail_url=?,last_synced_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(details.title || parsed.slug, canonicalUrl, instructor, details.image_480x270 || null, now(), localCourseId).run();
    } else {
      const inserted = await database.prepare("INSERT INTO courses (user_id,course_id,title,url,instructor,thumbnail_url,last_synced_at) VALUES (?,?,?,?,?,?,?)")
        .bind(job.user_id, courseId, details.title || parsed.slug, canonicalUrl, instructor, details.image_480x270 || null, now()).run();
      localCourseId = Number(inserted.meta.last_row_id);
    }
    for (let s = 0; s < sections.length; s++) {
      const section = sections[s];
      let sectionRow = await database.prepare("SELECT id FROM sections WHERE course_id=? AND position=?").bind(localCourseId, s + 1).first<Row>();
      if (sectionRow) await database.prepare("UPDATE sections SET title=? WHERE id=?").bind(section.title, sectionRow.id).run();
      else {
        const inserted = await database.prepare("INSERT INTO sections (course_id,title,position) VALUES (?,?,?)").bind(localCourseId, section.title, s + 1).run();
        sectionRow = { id: inserted.meta.last_row_id };
      }
      for (let l = 0; l < section.lectures.length; l++) {
        const lecture = section.lectures[l];
        const existingLecture = await database.prepare(`SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=? AND l.lecture_id=?`)
          .bind(localCourseId, lecture.id).first<Row>();
        const lectureUrl = `${canonicalUrl.replace(/\/$/, "")}/learn/lecture/${lecture.id}`;
        if (existingLecture) await database.prepare(`UPDATE lectures SET section_id=?,title=?,url=?,lecture_type=?,duration=?,position=?,captions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(sectionRow.id, lecture.title, lectureUrl, lecture.type, lecture.duration, l + 1, JSON.stringify(lecture.captions), existingLecture.id).run();
        else await database.prepare(`INSERT INTO lectures (section_id,lecture_id,title,url,lecture_type,duration,position,learning_status,captions_json) VALUES (?,?,?,?,?,?,?,'NOT_STARTED',?)`)
          .bind(sectionRow.id, lecture.id, lecture.title, lectureUrl, lecture.type, lecture.duration, l + 1, JSON.stringify(lecture.captions)).run();
      }
    }
    await database.prepare("UPDATE processing_jobs SET course_id=?,status='COMPLETED',completed_items=1,progress_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(localCourseId, `Course '${details.title || parsed.slug}' imported with ${sections.length} sections.`, job.id).run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Course import failed.";
    await database.prepare("UPDATE processing_jobs SET status='FAILED',failed_items=1,error_message=?,progress_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(detail, `Import failed: ${detail}`, job.id).run();
  }
}

async function api(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method.toUpperCase();
  if (!path.length && method === "GET") return json({ service: "Udemy Subtitle Manager API", runtime: "ChatGPT Sites Worker" });
  if (path[0] === "health" && method === "GET") return json({ status: "ok" });
  if (path[0] === "drive" && path[1] === "callback" && method === "GET") return driveCallback(request, url);

  const user = await currentUser();
  if (path[0] === "auth" && path[1] === "me" && method === "GET") return json(await apiUserProfile(user));
  if (path[0] === "auth" && path[1] === "logout" && method === "POST") return json({ message: "Signed out from ChatGPT." });
  if (path[0] === "auth" && ["login", "register"].includes(path[1] || "")) return fail("This Site uses your ChatGPT sign-in; account passwords are managed by ChatGPT.", 410);
  if (path[0] === "udemy") return udemyRoutes(request, user, path.slice(1), url);
  if (path[0] === "drive") return driveRoutes(request, user, path.slice(1), url);
  if (path[0] === "courses") return courseRoutes(request, user, path.slice(1), url);
  if (path[0] === "subtitles") return subtitleRoutes(request, user, path.slice(1), url);
  if (path[0] === "jobs") return jobRoutes(request, user, path.slice(1), url);
  return fail("Not found.", 404);
}

export async function handleApi(request: Request) {
  try { return await api(request); }
  catch (error) {
    if (error instanceof ApiError) return fail(error.message, error.status);
    console.error("Site API request failed", error instanceof Error ? error.name : "UnknownError");
    return fail("Unexpected server error.", 500);
  }
}
