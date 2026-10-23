import { releaseCommit } from "./release";
import { normalizeCourseTags } from "./course-tags";
import { loadCourseRows, loadCourseSummaries } from "./course-reader";
import { env } from "cloudflare:workers";
import { getDb, type SitesDatabase } from "../../db";
import { getChatGPTUser } from "../chatgpt-auth";
import { hostedAcceptanceUserId } from "./hosted-acceptance-policy.mjs";
import { courseImportSchema, lectureUpdateSchema, requestObjectSchema, subtitleProcessSchema } from "./api-validation";
import { z } from "zod";

type Row = Record<string, any>;
type UserRow = { created_at?: string; id: number; email: string; platform_user_id: string; is_active: number; drive_credentials: string | null };
type CookieBundle = { text: string; jar: Record<string, string>; businessDomain: string | null };
type Caption = Record<string, any>;

const UDEMY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const now = () => new Date().toISOString();
const db = () => getDb();
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
  let payload: unknown;
  try { payload = await request.json(); } catch { throw new ApiError(400, "Request body must be valid JSON."); }
  const parsed = requestObjectSchema.safeParse(payload);
  if (!parsed.success) throw new ApiError(400, "Request body must be a JSON object.");
  return parsed.data;
}

function validatePayload<T extends z.ZodType>(payload: Row, schema: T): z.output<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const field = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return `${field}${issue.message}`;
    });
    throw new ApiError(400, details.join(" "));
  }
  return parsed.data;
}

class SessionRequired extends Error {}

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function currentUser(request: Request, path: string[]): Promise<UserRow> {
  const identity = await getChatGPTUser();
  const database = db();
  let user: UserRow | null;
  if (identity) {
    await database.prepare(`INSERT INTO users (platform_user_id,email,is_active) VALUES (?,?,1)
      ON CONFLICT(platform_user_id) DO UPDATE SET email=excluded.email,updated_at=CURRENT_TIMESTAMP`)
      .bind(identity.userId, identity.email).run();
    user = await database.prepare("SELECT * FROM users WHERE platform_user_id=? AND is_active=1")
      .bind(identity.userId).first<UserRow>();
  } else {
    const acceptanceUserId = hostedAcceptanceUserId({
      method: request.method, path: path.join("/"), suppliedSecret: request.headers.get("x-hosted-acceptance-secret"),
      expectedSecret: (env as any).HOSTED_ACCEPTANCE_SECRET, userId: (env as any).HOSTED_ACCEPTANCE_USER_ID,
    });
    if (!acceptanceUserId) {
      throw new ApiError(401, "Sign in to ChatGPT to use this Site.");
    }
    user = await database.prepare("SELECT * FROM users WHERE platform_user_id=? AND is_active=1")
      .bind(acceptanceUserId).first<UserRow>();
  }
  if (!user) throw new ApiError(401, "Your ChatGPT account is not active for this Site.");
  await normalizeDriveCredentials(user);
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
  if (!secret || secret.length < 32 || !value.startsWith("v1.")) throw new Error("Stored credentials could not be decrypted.");
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
  const response = await fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(12000), headers, redirect: "follow" });
  return response;
}

async function udemyValidation(jar: Record<string, string>, businessDomain: string | null) {
  const hosts = [...new Set([businessDomain, "www.udemy.com"].filter(Boolean) as string[])];
  let lastStatus = 0;
  for (const host of hosts) {
    try {
      const response = await udemyFetch(`https://${host}/api-2.0/users/me/`, jar, {signal:AbortSignal.timeout(4000)});
      lastStatus = response.status;
      if (response.ok) {
        const user = await response.json() as Row;
        const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.display_name || user.email || null;
        return { status: "CONNECTED", accountName: name as string | null, error: null as string | null };
      }
      if (response.status === 403) return { status: "ACCESS_DENIED", accountName: null, error: "Udemy denied access to this session." };
      if (response.status === 401) return { status: "EXPIRED_SESSION", accountName: null, error: "Udemy session expired." };
    } catch {
      return { status: "VERIFICATION_FAILED", accountName: null, error: "Udemy verification timed out or could not connect. Cookies are retained; try Test Connection again." };
    }
  }
  return { status: lastStatus === 401 ? "EXPIRED_SESSION" : lastStatus === 403 ? "ACCESS_DENIED" : "VERIFICATION_FAILED", accountName: null, error: `Udemy returned HTTP ${lastStatus || "unknown"}.` };
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

function udemyDomainUpdates(database: SitesDatabase, userId: number, domain: string) {
  if (!isUdemyDomain(domain)) throw new ApiError(400,"Invalid Udemy domain.");
  // Only replace the URL authority; preserve lecture paths and query strings.
  // Scope both updates to the signed-in owner and skip unrelated/existing URLs.
  const host = "lower(substr(url,instr(url,'://')+3,instr(substr(url,instr(url,'://')+3)||'/','/')-1))";
  const path = "CASE WHEN instr(substr(url,instr(url,'://')+3),'/')>0 THEN substr(url,instr(url,'://')+2+instr(substr(url,instr(url,'://')+3),'/')) ELSE '/' END";
  const eligible = `(url LIKE 'https://%' OR url LIKE 'http://%') AND (${host}='udemy.com' OR ${host} LIKE '%.udemy.com') AND url != 'https://' || ? || ${path}`;
  return [
    database.prepare(`UPDATE courses SET url='https://' || ? || ${path} WHERE user_id=? AND ${eligible}`).bind(domain,userId,domain),
    database.prepare(`UPDATE lectures SET url='https://' || ? || ${path} WHERE section_id IN
      (SELECT s.id FROM sections s JOIN courses c ON c.id=s.course_id WHERE c.user_id=?) AND ${eligible}`).bind(domain,userId,domain),
  ];
}

async function saveUdemySession(user: UserRow, bundle: CookieBundle, validation: Row) {
  const database = db();
  const encrypted = await encrypt(bundle.text);
  await database.batch([
    database.prepare(`INSERT INTO udemy_sessions (user_id,encrypted_cookie_data,status,account_name,business_domain,error_message,last_validated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_cookie_data=excluded.encrypted_cookie_data,status=excluded.status,
      account_name=excluded.account_name,business_domain=excluded.business_domain,error_message=excluded.error_message,last_validated_at=excluded.last_validated_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(user.id, encrypted, validation.status, validation.accountName, bundle.businessDomain, validation.error, now()),
    ...udemyDomainUpdates(database,user.id,bundle.businessDomain || "www.udemy.com"),
    database.prepare("UPDATE processing_jobs SET status='PENDING',attempts=0,retry_at=NULL,error_message=NULL,progress_message='Udemy cookies saved. Resuming from saved lecture.' WHERE user_id=? AND status='WAITING_SESSION'").bind(user.id),
  ]);
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
    return json({...udemyStatus(await getUdemySession(user.id)),saved:true});
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
        .bind("Stored credentials could not be decrypted.", now(), user.id).run();
    }
    return json(udemyStatus(await getUdemySession(user.id)));
  }
  if (path[0] === "sync-domains" && request.method === "POST") {
    const bundle = await getCookieBundle(user.id);
    if (!bundle) throw new ApiError(400, "No Udemy cookies found. Please upload cookies first.");
    const domain = bundle.businessDomain || "www.udemy.com";
    const results = await database.batch(udemyDomainUpdates(database,user.id,domain));
    return json({ status: "success", domain, courses_updated: Number(results[0].meta.changes), lectures_updated: Number(results[1].meta.changes) });
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
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(12000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const token = await response.json() as Row;
  if (!response.ok || !token.access_token) return Response.redirect(new URL(`/dashboard?drive_error=${encodeURIComponent("Google Drive token exchange failed. Check the OAuth redirect URI.")}`, url.origin), 302);
  const user = await database.prepare("SELECT * FROM users WHERE id=?").bind(savedState.user_id).first<UserRow>();
  if (!user) return Response.redirect(new URL("/dashboard", url.origin), 302);
  const credentials = { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Date.now() + Number(token.expires_in || 3600) * 1000, scope: token.scope, token_type: token.token_type };
  await database.prepare("UPDATE users SET drive_credentials=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await encrypt(JSON.stringify(credentials)), user.id).run();
  return Response.redirect(new URL("/dashboard?drive_connected=true", url.origin), 302);
}

async function courseRoutes(request: Request, user: UserRow, path: string[], url: URL) {
  const database = db();
  if (path.length === 1 && path[0] === "tags" && request.method === "GET") {
    const rows = await database.prepare("SELECT tags_json FROM courses WHERE user_id=?").bind(user.id).all<Row>();
    const tags = new Map<string,string>();
    for (const row of rows.results) {
      let values: unknown;
      try { values = JSON.parse(row.tags_json || "[]"); } catch { continue; }
      if (!Array.isArray(values)) continue;
      for (const tag of values) if (typeof tag === "string" && tag.trim()) {
        const normalized = tag.normalize("NFKC").trim().replace(/\s+/g," ");
        if (normalized) tags.set(normalized.toLowerCase(),normalized);
      }
    }
    return json([...tags.values()].sort((a,b)=>a.localeCompare(b)));
  }
  if (path.length === 1 && path[0] === "import" && request.method === "POST") {
    const payload = validatePayload(await bodyJson(request), courseImportSchema);
    const normalized = validUdemyUrl(payload.url);
    let tags: string[];
    try { tags = normalizeCourseTags(payload.tags ?? []); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid tags."); }
    return json(await ensureJob(user.id, "COURSE_IMPORT", null, { url: normalized.url, tags, download_subtitles: true }, 1), 202);
  }
  if (path.length === 0 && request.method === "GET") {
    const page = safeInt(url.searchParams.get("page"), 1, 1, 1_000_000);
    const pageSize = safeInt(url.searchParams.get("page_size"), 20, 1, 100);
    const search = (url.searchParams.get("search") || "").trim();
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const query = search ? "SELECT * FROM courses WHERE user_id=? AND title LIKE ? ESCAPE '\\'" : "SELECT * FROM courses WHERE user_id=?";
    const bind = search ? [user.id, term] : [user.id];
    const total = await database.prepare(search ? "SELECT COUNT(*) AS total FROM courses WHERE user_id=? AND title LIKE ? ESCAPE '\\'" : "SELECT COUNT(*) AS total FROM courses WHERE user_id=?").bind(...bind).first<Row>();
    const rows = await database.prepare(`${query} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...bind, pageSize, (page - 1) * pageSize).all<Row>();
    const summaries = await loadCourseSummaries(database, rows.results.map((course) => Number(course.id)));
    const items = rows.results.map((course) => ({
      id: Number(course.id), course_id: String(course.course_id), title: course.title, url: course.url,
      tags: JSON.parse(course.tags_json || "[]") as string[], instructor: course.instructor ?? null,
      thumbnail_url: course.thumbnail_url ?? null, ...summaries.get(Number(course.id)),
      last_synced_at: course.last_synced_at, created_at: course.created_at,
    }));
    return json({ items, total: Number(total?.total || 0) });
  }
  if (path[0] === "lectures" && path.length === 2 && request.method === "PATCH") {
    const lectureId = Number(path[1]);
    const lecture = await ownedLecture(user.id, lectureId);
    const payload = validatePayload(await bodyJson(request), lectureUpdateSchema);
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
  if (path.length === 2 && path[1] === "instructor" && request.method === "GET") {
    const course = await ownedCourse(user.id, id);
    const fallback = new URL(course.url);
    fallback.hash = "instructor-1";
    try {
      const cookies = await getCookieBundle(user.id).catch(() => null);
      const courseUrl = new URL(course.url);
      const fields = new URLSearchParams({ "fields[course]": "visible_instructors", "fields[user]": "url,display_name" });
      const response = await udemyFetch(`https://${courseUrl.hostname}/api-2.0/courses/${encodeURIComponent(course.course_id)}/?${fields}`, cookies?.jar ?? {}, { signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const details = await response.json() as Row;
        const profile = details.visible_instructors?.[0]?.url;
        if (profile) {
          const target = new URL(profile, "https://www.udemy.com");
          if (target.protocol === "https:" && (target.hostname === "udemy.com" || target.hostname.endsWith(".udemy.com"))) return Response.redirect(target.toString(), 302);
        }
      }
    } catch { /* The course's instructor section remains a valid Udemy destination. */ }
    return Response.redirect(fallback.toString(), 302);
  }
  if (path.length === 1 && request.method === "GET") return json(await courseRead(await ownedCourse(user.id, id), true));
  if (path.length === 1 && request.method === "DELETE") {
    const course = await ownedCourse(user.id, id);
    await ensureJob(user.id,"CLEANUP",null,{scope:"course",target_id:id},1);
    return json({message:`Deletion queued for '${course.title}'. Cleanup progress is retained until all files are removed.`},202);
  }
  return fail("Not found.", 404);
}

async function subtitleRoutes(request: Request, user: UserRow, path: string[], _url: URL) {
  const database = db();
  if (path[0] === "process" && path.length === 1 && request.method === "POST") {
    const payload = validatePayload(await bodyJson(request), subtitleProcessSchema);
    const language = String(payload.language || "en");
    let rows: Row[] = [];
    if (payload.lecture_ids?.length) {
      const ids = payload.lecture_ids;
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
          [driveConfig().folderName, safeDriveName(lecture.course_title), `Section ${String(lecture.section_position).padStart(2, "0")} - ${safeDriveName(lecture.section_title)}`], subtitle!.id);
        await database.prepare("UPDATE subtitles SET drive_file_id=?,drive_file_url=?,drive_status='COMPLETED',drive_error=NULL WHERE id=?").bind(upload.id, upload.url, subtitle!.id).run();
      } catch (error) {
        await database.prepare("UPDATE subtitles SET drive_error=?,drive_status='FAILED' WHERE id=?").bind(`Saved to Site storage. Drive upload failed: ${error instanceof Error ? error.message : "unknown error"}`, subtitle!.id).run();
        message = "Subtitle saved to Site storage, but Google Drive upload failed.";
      }
    }
    const latest = await database.prepare("SELECT * FROM subtitles WHERE id=?").bind(subtitle!.id).first<Row>();
    return json({ subtitle: subtitleRead(latest!), message });
  }
  if (path[0] === "lectures" && path.length === 2 && request.method === "DELETE") {
    const lectureId = Number(path[1]);
    await ownedLecture(user.id, lectureId);
    await ensureJob(user.id,"CLEANUP",null,{scope:"lecture",target_id:lectureId},1);
    return json({message:"Subtitle deletion queued.",lecture_id:lectureId},202);
  }
  const id = Number(path[0]);
  if (Number.isInteger(id) && id > 0 && path.length === 1 && request.method === "DELETE") {
    const subtitle = await database.prepare(`SELECT sub.* FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE sub.id=? AND c.user_id=?`).bind(id, user.id).first<Row>();
    if (!subtitle) throw new ApiError(404, "Subtitle not found.");
    await ensureJob(user.id,"CLEANUP",null,{scope:"subtitle",target_id:id},1);
    return json({message:"Subtitle deletion queued.",id},202);
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
  if (path.length === 1 && path[0] === "run" && request.method === "POST") {
    const advanced = await processPendingJob(user.id);
    return json({ scheduled: true, advanced });
  }
  if (!path.length && request.method === "GET") {
    // Job reads are side-effect free; the unattended dispatcher advances work.
    const courseId = Number(url.searchParams.get("course_id") || 0);
    const limit = safeInt(url.searchParams.get("limit"), 10, 1, 50);
    const rows = courseId
      ? await database.prepare("SELECT * FROM processing_jobs WHERE user_id=? AND (course_id=? OR job_type='CLEANUP') ORDER BY created_at DESC,id DESC LIMIT ?").bind(user.id, courseId, limit).all<Row>()
      : await database.prepare("SELECT * FROM processing_jobs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ?").bind(user.id, limit).all<Row>();
    return json(rows.results.map(jobRead));
  }
  const id = Number(path[0]);
  if (!Number.isInteger(id) || id <= 0) return fail("Not found.", 404);
  let job = await database.prepare("SELECT * FROM processing_jobs WHERE id=? AND user_id=?").bind(id, user.id).first<Row>();
  if (!job) throw new ApiError(404, "Job not found.");
  if (path.length === 1 && request.method === "GET") {
    // Job reads are side-effect free; the unattended dispatcher advances work.
    job = await database.prepare("SELECT * FROM processing_jobs WHERE id=? AND user_id=?").bind(id, user.id).first<Row>();
    return json(jobRead(job!));
  }
  if (path.length === 2 && path[1] === "retry" && request.method === "POST") {
    await database.prepare("UPDATE processing_jobs SET status='PENDING',attempts=0,retry_at=NULL,error_message=NULL WHERE id=? AND status IN ('FAILED','CANCELLED')").bind(id).run();
    return json(jobRead((await database.prepare("SELECT * FROM processing_jobs WHERE id=?").bind(id).first<Row>())!));
  }
  if (path.length === 2 && path[1] === "cancel" && request.method === "POST") {
    if (job.job_type === "CLEANUP") throw new ApiError(409,"File cleanup must finish and cannot be cancelled.");
    if (!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
      await database.prepare("UPDATE processing_jobs SET status='CANCELLED',progress_message='Cancellation requested.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
        .bind(id, user.id).run();
      job = await database.prepare("SELECT * FROM processing_jobs WHERE id=? AND user_id=?").bind(id, user.id).first<Row>();
    }
    return json(jobRead(job!));
  }
  return fail("Not found.", 404);
}

async function assertNoCleanup(userId: number) {
  const cleanup = await db().prepare("SELECT id FROM processing_jobs WHERE user_id=? AND job_type='CLEANUP' AND status!='COMPLETED' LIMIT 1").bind(userId).first<Row>();
  if (cleanup) throw new ApiError(409,"File deletion is pending. Wait for cleanup to finish before starting new processing or imports.");
}

async function ensureJob(userId: number, jobType: string, courseId: number | null, payload: Row, totalItems: number) {
  if (jobType !== "CLEANUP") await assertNoCleanup(userId);
  const result = await db().prepare(`INSERT INTO processing_jobs (user_id,course_id,job_type,status,total_items,payload_json,progress_message)
    VALUES (?,?,?,'PENDING',?,?,?)`).bind(userId, courseId, jobType, totalItems, JSON.stringify(payload), "Queued for processing.").run();
  const id = Number(result.meta.last_row_id);
  const row = await db().prepare("SELECT * FROM processing_jobs WHERE id=?").bind(id).first<Row>();
  return jobRead(row!);
}

function jobRead(row: Row) {
  const active = ["PENDING", "PROCESSING"].includes(row.status);
  const due = row.retry_at == null || Number(row.retry_at) <= Math.floor(Date.now() / 1000);
  const stalled = active && due && Date.parse(`${row.updated_at}Z`) < Date.now() - 15 * 60_000;
  return {
    id: Number(row.id), user_id: Number(row.user_id), course_id: row.course_id == null ? null : Number(row.course_id),
    job_type: row.job_type, status: row.status, total_items: Number(row.total_items),
    completed_items: Number(row.completed_items), failed_items: Number(row.failed_items),
    attempts: Number(row.attempts || 0), retry_at: row.retry_at == null ? null : Number(row.retry_at),
    progress_message: row.progress_message ?? null, error_message: row.error_message ?? null,
    created_at: row.created_at, updated_at: row.updated_at, stalled,
  };
}

function subtitleRead(row: Row) {
  return {
    id: Number(row.id), lecture_id: Number(row.lecture_id), language: row.language,
    subtitle_type: row.subtitle_type, status: row.status, download_status: row.status, drive_status: row.drive_status ?? "NOT_REQUESTED", drive_error: row.drive_error ?? null, caption_language: row.caption_language ?? row.language, drive_file_id: row.drive_file_id ?? null,
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

async function courseRead(course: Row, includeSections = false, data?: { sections: Row[]; lectures: Row[]; subtitles: Row[] }) {
  const rows = data ?? await loadCourseRows(db(), [course.id]);
  const sections = rows.sections.filter((section) => Number(section.course_id) === Number(course.id));
  const lecturesBySection = new Map<number, Row[]>();
  const subtitlesByLecture = new Map<number, Row[]>();
  for (const lecture of rows.lectures) {
    const id = Number(lecture.section_id);
    const group = lecturesBySection.get(id) ?? [];
    group.push(lecture); lecturesBySection.set(id, group);
  }
  for (const subtitle of rows.subtitles) {
    const id = Number(subtitle.lecture_id);
    const group = subtitlesByLecture.get(id) ?? [];
    group.push(subtitle); subtitlesByLecture.set(id, group);
  }
  const orderedLectures = sections.flatMap((section) => lecturesBySection.get(Number(section.id)) ?? []);
  const subtitles = orderedLectures.flatMap((lecture) => subtitlesByLecture.get(Number(lecture.id)) ?? []);
  const nextLecture = orderedLectures.find((lecture) => lecture.learning_status === "IN_PROGRESS")
    ?? orderedLectures.find((lecture) => lecture.learning_status === "NOT_STARTED");
  return {
    id: Number(course.id), course_id: String(course.course_id), title: course.title, url: course.url,
    tags: JSON.parse(course.tags_json || "[]") as string[],
    instructor: course.instructor ?? null, thumbnail_url: course.thumbnail_url ?? null,
    total_sections: sections.length, total_lectures: orderedLectures.length,
    completed_lectures: orderedLectures.filter((lecture) => lecture.learning_status === "COMPLETED").length,
    subtitle_eligible_lectures: orderedLectures.filter((lecture) => lecture.lecture_type === "video").length,
    processed_subtitles: orderedLectures.filter((lecture) => lecture.lecture_type === "video" && subtitlesByLecture.get(Number(lecture.id))?.some((subtitle) => subtitle.status === "COMPLETED")).length,
    failed_subtitles: orderedLectures.filter((lecture) => lecture.lecture_type === "video" && subtitlesByLecture.get(Number(lecture.id))?.some((subtitle) => subtitle.status === "FAILED") && !subtitlesByLecture.get(Number(lecture.id))?.some((subtitle) => subtitle.status === "COMPLETED")).length,
    drive_sync_failed: subtitles.filter((subtitle) => subtitle.drive_status === "FAILED").length,
    next_lecture: nextLecture ? lectureRead(nextLecture, subtitlesByLecture.get(Number(nextLecture.id))) : null,
    next_lecture_section: nextLecture ? sections.find((section) => Number(section.id) === Number(nextLecture.section_id)) ?? null : null,
    last_synced_at: course.last_synced_at, created_at: course.created_at,
    ...(includeSections ? { sections: sections.map((section) => ({
      id: Number(section.id), course_id: Number(section.course_id), title: section.title, position: Number(section.position),
      lectures: (lecturesBySection.get(Number(section.id)) ?? []).map((lecture) => lectureRead(lecture, subtitlesByLecture.get(Number(lecture.id)))),
    })) } : {}),
  };
}

async function ownedCourse(userId: number, id: number) {
  const course = await db().prepare("SELECT * FROM courses WHERE id=? AND user_id=?").bind(id, userId).first<Row>();
  if (!course) throw new ApiError(404, "Course not found.");
  return course;
}

async function ownedLecture(userId: number, id: number) {
  const lecture = await db().prepare(`SELECT l.*,s.course_id,c.course_id AS udemy_course_id,c.user_id,c.title AS course_title,c.url AS course_url,s.title AS section_title,s.position AS section_position
    FROM lectures l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id
    WHERE l.id=? AND c.user_id=?`).bind(id, userId).first<Row>();
  if (!lecture) throw new ApiError(404, "Lecture not found.");
  return lecture;
}

async function normalizeDriveCredentials(user: UserRow) {
  if (!user.drive_credentials) return null;
  const stored = user.drive_credentials;
  const credentials = JSON.parse(stored.startsWith("v1.") ? await decrypt(stored) : stored) as Row;
  if (!stored.startsWith("v1.")) {
    const encrypted = await encrypt(JSON.stringify(credentials));
    await db().prepare("UPDATE users SET drive_credentials=? WHERE id=? AND drive_credentials=?").bind(encrypted,user.id,stored).run();
    user.drive_credentials = encrypted;
  }
  return credentials;
}

// Bounded migration also covers dormant connections when the dispatcher runs.
async function migrateDriveCredentials() {
  const rows = await db().prepare("SELECT * FROM users WHERE drive_credentials IS NOT NULL AND drive_credentials NOT LIKE 'v1.%' LIMIT 25").all<UserRow>();
  for (const user of rows.results) await normalizeDriveCredentials(user);
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
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(12000), headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json() as Row;
  if (!response.ok || !data.access_token) throw new ApiError(401, "Google Drive token refresh failed. Reconnect Drive.");
  const next = { ...credentials, refresh_token: data.refresh_token || credentials.refresh_token, access_token: data.access_token, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
  await db().prepare("UPDATE users SET drive_credentials=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await encrypt(JSON.stringify(next)), user.id).run();
  credentials.refresh_token = next.refresh_token;
  credentials.access_token = next.access_token;
  credentials.expires_at = next.expires_at;
  return next.access_token as string;
}

async function driveRequest(user: UserRow, credentials: Row, url: string, init: RequestInit = {}) {
  const token = await driveAccessToken(user, credentials);
  const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12000), headers });
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

async function driveUpload(user: UserRow, credentials: Row, name: string, content: string, hierarchy: string[], subtitleId?: number) {
  const parent = await driveFolder(user, credentials, hierarchy);
  let reservedId: string | undefined;
  if (subtitleId) {
    const saved = await db().prepare("SELECT drive_file_id FROM subtitles WHERE id=?").bind(subtitleId).first<Row>();
    reservedId = saved?.drive_file_id || undefined;
    if (!reservedId) {
      const generated = await driveRequest(user, credentials, "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files");
      reservedId = ((await generated.json()) as Row).ids[0];
      await db().prepare("UPDATE subtitles SET drive_file_id=?,drive_status='PENDING' WHERE id=? AND drive_file_id IS NULL").bind(reservedId, subtitleId).run();
      reservedId = (await db().prepare("SELECT drive_file_id FROM subtitles WHERE id=?").bind(subtitleId).first<Row>())!.drive_file_id;
    }
    const token = await driveAccessToken(user, credentials);
    const existing = await fetch(`https://www.googleapis.com/drive/v3/files/${reservedId}?fields=id,webViewLink`, {headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(12000)});
    if (existing.ok) { const file = await existing.json() as Row; return {id:file.id,url:file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`}; }
    if (existing.status !== 404) throw new Error(`Drive readback returned HTTP ${existing.status}`);
  }
  const metadata = { ...(reservedId ? {id: reservedId} : {}), name: safeDriveName(name), ...(parent ? { parents: [parent] } : {}) };
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
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: "DELETE", signal: AbortSignal.timeout(12000), headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok && response.status !== 404) throw new ApiError(response.status, `Google Drive returned HTTP ${response.status}.`);
}

function canonicalLanguage(language: string) {
  return language.trim().toLowerCase().split(/[-_]/)[0] || "en";
}

async function storeSubtitle(user: UserRow, lecture: Row, language: string, content: string, type: string) {
  const identity = canonicalLanguage(language);
  const key = `${user.id}/${lecture.course_id}/${lecture.lecture_id}/${identity}.vtt`;
  await bucket().put(key, content, { httpMetadata: { contentType: "text/vtt; charset=utf-8" } });
  await db().prepare(`INSERT INTO subtitles (lecture_id,language,caption_language,subtitle_type,status,storage_key,last_processed_at)
    VALUES (?,?,?,?,'COMPLETED',?,?) ON CONFLICT(lecture_id,language) DO UPDATE SET
    caption_language=excluded.caption_language,subtitle_type=excluded.subtitle_type,status='COMPLETED',
    storage_key=excluded.storage_key,error_message=NULL,error_category=NULL,last_processed_at=excluded.last_processed_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(lecture.id, identity, language, type, key, now()).run();
  return db().prepare("SELECT * FROM subtitles WHERE lecture_id=? AND language=?").bind(lecture.id, identity).first<Row>();
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
  try { captions = JSON.parse(lecture.captions_json || "[]") as Caption[]; } catch { /* Refresh malformed cache. */ }
  const refresh = async () => {
    if (!cookies) throw new SessionRequired("Caption link expired. Reconnect your Udemy session to refresh subtitle links.");
    if (!lecture.udemy_course_id) throw new Error("Udemy course ID is missing. Re-sync the course curriculum.");
    const host = new URL(lecture.course_url).hostname;
    const url = new URL(`https://${host}/api-2.0/users/me/subscribed-courses/${encodeURIComponent(lecture.udemy_course_id)}/lectures/${encodeURIComponent(lecture.lecture_id)}/`);
    url.searchParams.set("fields[lecture]", "title,asset,transcript"); url.searchParams.set("fields[asset]", "@all");
    const response = await udemyFetch(url.toString(), cookies.jar);
    if ([401,403].includes(response.status)) throw new SessionRequired(`Udemy lecture refresh returned HTTP ${response.status}. Reconnect Udemy.`);
    if (!response.ok) throw new Error(`Udemy lecture refresh returned HTTP ${response.status}. ${[401,403].includes(response.status) ? "Refresh your Udemy session cookies and confirm course access." : "Please retry later."}`);
    const data = await response.json() as Row;
    captions = data.asset?.captions || data.asset?.subtitles || [];
    await db().prepare("UPDATE lectures SET captions_json=? WHERE id=?").bind(JSON.stringify(captions), lecture.id).run();
  };
  let refreshed = false;
  if (!chooseCaption(captions,language).caption) {
    if (!cookies) {
      return { error: "Udemy session is unavailable, so subtitle tracks could not be checked. Reconnect Udemy and retry.", category: "SESSION_REQUIRED" };
    }
    await refresh();
    refreshed = true;
  }
  for (;;) {
    const selected = chooseCaption(captions, language);
    const captionUrl = selected.caption?.url || selected.caption?.download_url;
    if (!captionUrl) return { error: "No subtitles found for this lecture.", category: "NO_SUBTITLES" };
    const parsedUrl = new URL(captionUrl);
    if (parsedUrl.protocol !== "https:") return { error: "Udemy returned an unsafe caption URL.", category: "CAPTION_ERROR" };
    // Signed CDN URLs need no Udemy cookies or bearer token. Never leak those to CDN hosts.
    const response = await fetch(parsedUrl.toString(), {headers:{"User-Agent":UDEMY_UA,Accept:"text/vtt, text/plain, */*",Referer:lecture.course_url},signal:AbortSignal.timeout(12000)});
    if ([401,403,404].includes(response.status) && !refreshed) { await refresh(); refreshed = true; continue; }
    if (!response.ok) return { error: `Caption download returned HTTP ${response.status} after ${refreshed ? "refreshing" : "reading"} the subtitle link.`, category: "CAPTION_ERROR" };
    const raw = await response.text();
    if (/^\s*</.test(raw) || !/\d{2}:\d{2}[.,]\d{3}\s*-->/.test(raw)) return {error:"Udemy returned an invalid caption document instead of subtitle cues.",category:"CAPTION_ERROR"};
    const finalLanguage = String(selected.caption?.locale_id || selected.caption?.lang || selected.caption?.language || language);
    return { content: normalizeVtt(raw), type: selected.type, language: finalLanguage };
  }
}

async function processSubtitle(user: UserRow, lecture: Row, language: string) {
  language = canonicalLanguage(language);
  const database = db();
  const cookies = await getCookieBundle(user.id).catch(() => null);
  const record = await database.prepare("SELECT * FROM subtitles WHERE lecture_id=? AND language=?").bind(lecture.id, language).first<Row>();
  if (lecture.lecture_type !== "video") {
    if (record) await database.prepare("UPDATE subtitles SET status='NO_SUBTITLES',subtitle_type='NONE',error_category='UNSUPPORTED_TYPE',error_message=?,last_processed_at=? WHERE id=?").bind("Lecture is not a video.", now(), record.id).run();
    else await database.prepare("INSERT INTO subtitles (lecture_id,language,subtitle_type,status,error_category,error_message,last_processed_at) VALUES (?,?,'NONE','NO_SUBTITLES','UNSUPPORTED_TYPE',?,?)").bind(lecture.id, language, "Lecture is not a video.", now()).run();
    return false;
  }
  let subtitle = record?.status === "COMPLETED" && record.storage_key ? record : null;
  let content: string;
  if (subtitle) {
    if (subtitle.drive_status === "COMPLETED" || !user.drive_credentials) return true;
    const stored = await bucket().get(subtitle.storage_key);
    if (!stored) throw new Error("Stored caption is missing; restore or reimport it before Drive sync.");
    content = await stored.text();
  } else {
    let result: Row;
    try { result = await subtitleContent(lecture, language, cookies); }
    catch (error) { if (error instanceof SessionRequired) throw error; result = {error: error instanceof Error ? error.message : "Caption download failed", category: "PROCESSING_ERROR"}; }
    if (!result.content) {
      if (result.category === "SESSION_REQUIRED") throw new SessionRequired(result.error);
      await database.prepare(`INSERT INTO subtitles (lecture_id,language,subtitle_type,status,error_category,error_message,last_processed_at)
        VALUES (?,?,'NONE',?,?,?,?) ON CONFLICT(lecture_id,language) DO UPDATE SET status=excluded.status,error_category=excluded.error_category,error_message=excluded.error_message,last_processed_at=excluded.last_processed_at`)
        .bind(lecture.id, language, result.category === "NO_SUBTITLES" ? "NO_SUBTITLES" : "FAILED", result.category, result.error, now()).run();
      if (result.category !== "NO_SUBTITLES" && result.category !== "SESSION_REQUIRED") throw new Error(result.error);
      return false;
    }
    content = result.content;
    subtitle = await storeSubtitle(user, lecture, result.language, content, result.type);
  }
  if (!subtitle) throw new Error("Saved subtitle could not be read back.");
  const credentials = await normalizeDriveCredentials(user);
  if (credentials) {
    try {
      const uploaded = await driveUpload(user, credentials, `${String(lecture.position).padStart(3, "0")} - ${lecture.title}.vtt`, content,
        [driveConfig().folderName, safeDriveName(lecture.course_title), `Section ${String(lecture.section_position).padStart(2, "0")} - ${safeDriveName(lecture.section_title)}`], subtitle.id);
      await database.prepare("UPDATE subtitles SET drive_file_id=?,drive_file_url=?,drive_status='COMPLETED',drive_error=NULL WHERE id=?").bind(uploaded.id, uploaded.url, subtitle.id).run();
    } catch (error) {
      await database.prepare("UPDATE subtitles SET drive_status='FAILED',drive_error=? WHERE id=?").bind(error instanceof Error ? error.message : "Drive upload failed", subtitle.id).run();
      throw error;
    }
  }
  return true;
}

async function retryJob(job: Row, error: unknown) {
  if (error instanceof SessionRequired) {
    await db().prepare("UPDATE processing_jobs SET status='WAITING_SESSION',retry_at=NULL,error_message=?,progress_message='Reconnect Udemy to resume this lecture.',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='CANCELLED'").bind(error.message,job.id).run();
    return;
  }
  const attempt = Number(job.attempts || 0) + 1;
  const detail = error instanceof Error ? error.message : "Processing failed";
  await db().prepare(`UPDATE processing_jobs SET status=?,attempts=?,retry_at=unixepoch()+?,error_message=?,progress_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='CANCELLED'`)
    .bind(attempt >= 8 && job.job_type !== "CLEANUP" ? "FAILED" : "PENDING", attempt, Math.min(3600, 15 * 2 ** attempt), detail,
      attempt >= 8 && job.job_type !== "CLEANUP" ? "Retries exhausted. Retry this job after correcting the error." : `Retry ${attempt}${job.job_type === "CLEANUP" ? "" : "/8"} queued; progress saved.`, job.id).run();
}

// Invoked using the trusted Sites identity after a successful enqueue/resume POST.
// The Worker owns this promise with waitUntil, so closing the browser does not cancel it.
export async function resumeUserJobs(platformUserId: string, budgetMs = 20_000) {
  const user = await db().prepare("SELECT id FROM users WHERE platform_user_id=? AND is_active=1").bind(platformUserId).first<Row>();
  if (!user) return;
  const deadline = Date.now() + budgetMs;
  do {
    const ready = await db().prepare("SELECT id FROM processing_jobs WHERE user_id=? AND status IN ('PENDING','PROCESSING') AND (retry_at IS NULL OR retry_at<=unixepoch()) LIMIT 1").bind(user.id).first<Row>();
    if (!ready || !await processPendingJob(Number(user.id))) return;
  } while (Date.now() < deadline);
}

export async function processPendingJob(userId: number) {
  const token = crypto.randomUUID();
  const claim = await db().prepare(`INSERT INTO job_leases(user_id,token,expires_at) VALUES (?,?,unixepoch()+600)
    ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE job_leases.expires_at < unixepoch()`)
    .bind(userId,token).run();
  if (!claim.meta.changes) return false;
  try { await advanceJob(userId); return true; }
  finally { await db().prepare("DELETE FROM job_leases WHERE user_id=? AND token=?").bind(userId,token).run(); }
}

async function advanceJob(userId: number) {
  const database = db();
  const job = await database.prepare(`SELECT * FROM processing_jobs WHERE user_id=? AND (
    (status IN ('PENDING','PROCESSING') AND (retry_at IS NULL OR retry_at <= unixepoch()))
  ) ORDER BY CASE WHEN job_type='CLEANUP' THEN 0 ELSE 1 END,created_at,id LIMIT 1`).bind(userId).first<Row>();
  if (!job) return;
  const payload = JSON.parse(job.payload_json || "{}");
  if (job.job_type === "CLEANUP") {
    try { await cleanupStep(job,payload); } catch (error) { await retryJob(job,error); }
    return;
  }
  if (job.job_type === "COURSE_IMPORT") {
    await importCourseStep(job, payload);
    return;
  }
  if (job.job_type !== "SUBTITLE_BATCH") return;
  await database.prepare("UPDATE processing_jobs SET status='PROCESSING',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='CANCELLED'").bind(job.id).run();
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
      await retryJob(job, error);
      return;
    }
  }
  const next = cursor + 1;
  const finished = next >= ids.length;
  await database.prepare(`UPDATE processing_jobs SET completed_items=completed_items+?,failed_items=failed_items+?,payload_json=?,status=CASE WHEN status='CANCELLED' THEN status ELSE ? END,progress_message=?,attempts=0,retry_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(succeeded ? 1 : 0, succeeded ? 0 : 1, JSON.stringify({ ...payload, cursor: next }), finished ? "COMPLETED" : "PENDING",
      finished ? `Batch completed: ${Number(job.completed_items) + Number(succeeded)} succeeded, ${Number(job.failed_items) + Number(!succeeded)} failed or had no subtitles.` : `Processing (${next}/${ids.length}): ${lecture?.title || "lecture"}`, job.id).run();
}

// Cleanup executes under the same per-user lease as downloads and imports.
async function cleanupStep(job: Row, payload: Row) {
  const database = db();
  if (!payload.files) {
    const selector = payload.scope === "course" ? "c.id" : payload.scope === "lecture" ? "l.id" : "sub.id";
    const rows = await database.prepare(`SELECT sub.*,l.id AS target_lecture_id,c.id AS target_course_id FROM subtitles sub
      JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id
      WHERE ${selector}=? AND c.user_id=?`).bind(payload.target_id,job.user_id).all<Row>();
    const lectureRows = payload.scope === "course"
      ? await database.prepare("SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE c.id=? AND c.user_id=?").bind(payload.target_id,job.user_id).all<Row>()
      : {results: payload.scope === "lecture" ? [{id:payload.target_id}] : rows.results.map(r=>({id:r.target_lecture_id}))};
    const ids = lectureRows.results.map(r=>Number(r.id));
    const deletingCourse = payload.scope === "course" ? await database.prepare("SELECT url FROM courses WHERE id=? AND user_id=?").bind(payload.target_id,job.user_id).first<Row>() : null;
    const next = {...payload,files:rows.results.map(r=>({drive_file_id:r.drive_file_id,storage_key:r.storage_key})),cursor:0};
    const jobs = await database.prepare("SELECT * FROM processing_jobs WHERE user_id=? AND job_type IN ('SUBTITLE_BATCH','COURSE_IMPORT') AND status NOT IN ('COMPLETED','CANCELLED')").bind(job.user_id).all<Row>();
    const cancel = jobs.results.filter(r=>{
      const p=JSON.parse(r.payload_json || "{}");
      return (deletingCourse && r.job_type === "COURSE_IMPORT" && p.url && validUdemyUrl(p.url).slug === validUdemyUrl(deletingCourse.url).slug) || (payload.scope === "course" && (Number(r.course_id)===Number(payload.target_id) || Number(p.local_course_id)===Number(payload.target_id))) || (p.lecture_ids || []).some((id:number)=>ids.includes(id));
    }).map(r=>database.prepare("UPDATE processing_jobs SET status='CANCELLED',progress_message='Cancelled for deletion.' WHERE id=?").bind(r.id));
    const remove = payload.scope === "course"
      ? database.prepare("DELETE FROM courses WHERE id=? AND user_id=?").bind(payload.target_id,job.user_id)
      : payload.scope === "lecture"
        ? database.prepare("DELETE FROM subtitles WHERE lecture_id=? AND lecture_id IN (SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE c.user_id=?)").bind(payload.target_id,job.user_id)
        : database.prepare("DELETE FROM subtitles WHERE id=? AND id IN (SELECT sub.id FROM subtitles sub JOIN lectures l ON l.id=sub.lecture_id JOIN sections s ON s.id=l.section_id JOIN courses c ON c.id=s.course_id WHERE c.user_id=?)").bind(payload.target_id,job.user_id);
    await database.batch([database.prepare("UPDATE processing_jobs SET payload_json=?,total_items=? WHERE id=?").bind(JSON.stringify(next),next.files.length,job.id),...cancel,remove]);
    return;
  }
  const cursor = Number(payload.cursor || 0);
  const file = payload.files[cursor];
  if (file) {
    // R2 cleanup can proceed even when Drive requires reconnection.
    if (file.storage_key) await withTimeout(bucket().delete(file.storage_key));
    if (file.drive_file_id) {
      const user = await database.prepare("SELECT * FROM users WHERE id=?").bind(job.user_id).first<UserRow>();
      const credentials = user && await normalizeDriveCredentials(user);
      if (!user || !credentials) throw new Error("Reconnect Google Drive to finish queued deletion.");
      await deleteDriveFile(user,credentials,file.drive_file_id);
    }
  }
  const done = !file || cursor+1 >= payload.files.length;
  await database.prepare("UPDATE processing_jobs SET payload_json=?,completed_items=?,status=?,attempts=0,retry_at=NULL,error_message=NULL,progress_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(JSON.stringify({...payload,cursor:cursor+1}),Math.min(cursor+1,payload.files.length),done?"COMPLETED":"PENDING",done?"Deletion completed.":"Removing saved files.",job.id).run();
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Storage cleanup timed out.")),12000);})]); }
  finally { clearTimeout(timer!); }
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

async function importCourseStep(job: Row, payload: Row) {
  const database = db();
  try {
    const saveStep = async (nextPayload: Row, message: string, courseId: number | null = null, complete = false) => {
      const found = Number(nextPayload.lecture_count || 0);
      if (complete && nextPayload.download_subtitles) {
        const importedCourseId = Number(courseId ?? nextPayload.local_course_id);
        const lectures = await database.prepare(`SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id
          JOIN courses c ON c.id=s.course_id WHERE c.id=? AND c.user_id=? AND l.lecture_type='video' ORDER BY s.position,l.position`)
          .bind(importedCourseId, job.user_id).all<Row>();
        const ids = lectures.results.map((lecture) => Number(lecture.id));
        // One transaction saves tags and hands the same durable job to the next stage.
        // A restart sees either the import checkpoint or the subtitle checkpoint.
        await database.batch([
          database.prepare(`UPDATE courses SET tags_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?
            AND EXISTS(SELECT 1 FROM processing_jobs WHERE id=? AND job_type='COURSE_IMPORT' AND status!='CANCELLED')`)
            .bind(JSON.stringify(normalizeCourseTags(nextPayload.tags ?? [])), importedCourseId, job.user_id, job.id),
          database.prepare(`UPDATE processing_jobs SET course_id=?,job_type='SUBTITLE_BATCH',status=?,
            completed_items=0,failed_items=0,total_items=?,payload_json=?,progress_message=?,attempts=0,retry_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND job_type='COURSE_IMPORT' AND status!='CANCELLED'`)
            .bind(importedCourseId, ids.length ? "PENDING" : "COMPLETED", ids.length,
              JSON.stringify({lecture_ids:ids,language:"en",cursor:0}),
              ids.length ? `Course imported. Automatically downloading subtitles for ${ids.length} video lectures.` : "Course imported. No video lectures to download subtitles for.", job.id),
        ]);
        return;
      }
      await database.prepare(`UPDATE processing_jobs SET course_id=COALESCE(?,course_id),status=CASE WHEN status='CANCELLED' THEN status ELSE ? END,completed_items=?,total_items=?,payload_json=?,progress_message=?,attempts=0,retry_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(courseId, complete ? "COMPLETED" : "PENDING", complete ? Math.max(1, found) : found, complete ? Math.max(1, found) : 0,
          JSON.stringify(nextPayload), message, job.id).run();
    };

    if (!payload.stage || payload.stage === "details") {
      await database.prepare("UPDATE processing_jobs SET progress_message='Connecting to Udemy and reading course details.',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(job.id).run();
      const parsed = validUdemyUrl(payload.url);
      const session = await getUdemySession(Number(job.user_id));
      const cookies = session?.encrypted_cookie_data ? await getCookieBundle(Number(job.user_id)) : null;
      const domain = cookies?.businessDomain || parsed.domain;
      const courseFields = new URLSearchParams({ "fields[course]": "id,title,headline,image_480x270,visible_instructors,url" });
      const readWithTimeout = async (host: string) => {
        const response = await udemyFetch(`https://${host}/api-2.0/courses/${encodeURIComponent(parsed.slug)}/?${courseFields}`, cookies?.jar || {}, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new ApiError(response.status === 404 ? 404 : response.status === 401 ? 401 : response.status === 403 ? 403 : 502,
          response.status === 401 ? "Udemy session expired or is not enrolled in this course." : response.status === 403 ? "Udemy denied access to this course." : `Udemy returned HTTP ${response.status}.`);
        return response.json() as Promise<Row>;
      };
      let details: Row;
      try { details = await readWithTimeout(domain); }
      catch (error) { if (domain === "www.udemy.com") throw error; details = await readWithTimeout("www.udemy.com"); }
      const courseId = String(details.id);
      const canonicalUrl = details.url?.startsWith("/") ? `https://${domain}${details.url}` : parsed.url;
      const instructor = details.visible_instructors?.[0]?.display_name || null;
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
      const hosts = [...new Set([domain, "www.udemy.com"] as string[])];
      const endpoints = [...(cookies ? ["subscriber-curriculum-items"] : []), "public-curriculum-items"];
      await saveStep({ ...payload, stage: "curriculum", domain, slug: parsed.slug, udemy_course_id: courseId, local_course_id: localCourseId,
        title: details.title || parsed.slug, canonical_url: canonicalUrl, hosts, endpoints, host_index: 0, endpoint_index: 0,
        page_number: 0, lecture_count: 0, section_position: 0, lecture_position: 0, pending_section_title: "Introduction",
        current_section_id: null, has_curriculum: false }, `Course found: ${details.title || parsed.slug}. Preparing to read curriculum.`);
      return;
    }

    const session = await getUdemySession(Number(job.user_id));
    const cookies = session?.encrypted_cookie_data ? await getCookieBundle(Number(job.user_id)) : null;
    let hostIndex = Number(payload.host_index || 0);
    let endpointIndex = Number(payload.endpoint_index || 0);
    const hosts: string[] = payload.hosts || [payload.domain, "www.udemy.com"];
    const endpoints: string[] = payload.endpoints || ["public-curriculum-items"];
    if (payload.stage === "write_complete") {
      await saveStep(payload, `Imported ${Number(payload.lecture_count || 0)} lectures into ${Number(payload.section_position || 0)} sections.`, Number(payload.local_course_id), true);
      return;
    }
    if (hostIndex >= hosts.length || endpointIndex >= endpoints.length) {
      if (payload.has_curriculum) {
        await saveStep({ ...payload, stage: "write_complete" }, `Curriculum read: ${Number(payload.lecture_count || 0)} lectures found. Finishing import.`);
      } else {
        throw new ApiError(404, "Udemy returned no curriculum for this course.");
      }
      return;
    }

    const host = hosts[hostIndex];
    const endpoint = endpoints[endpointIndex];
    const params = new URLSearchParams({ page_size: "25", "fields[lecture]": "title,object_index,asset,sort_order", "fields[asset]": "title,asset_type,time_estimation,length,captions" });
    let target: URL;
    if (payload.next_url) target = new URL(String(payload.next_url));
    else {
      target = new URL(`https://${host}/api-2.0/courses/${encodeURIComponent(String(payload.udemy_course_id))}/${endpoint}/`);
      for (const [key, value] of params) target.searchParams.set(key, value);
    }
    await database.prepare("UPDATE processing_jobs SET progress_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(`Reading curriculum page ${Number(payload.page_number || 0) + 1} from ${host}…`, job.id).run();
    const response = await udemyFetch(target.toString(), cookies?.jar || {}, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      const nextEndpoint = endpointIndex + 1;
      await saveStep({ ...payload, next_url: null, host_index: nextEndpoint < endpoints.length ? hostIndex : hostIndex + 1,
        endpoint_index: nextEndpoint < endpoints.length ? nextEndpoint : 0 }, `Trying another Udemy curriculum endpoint for ${payload.title}.`);
      return;
    }
    const data = await response.json() as Row;
    const items: Row[] = data.results || [];
    let nextPayload: Row = { ...payload, has_curriculum: Boolean(payload.has_curriculum) || items.length > 0,
      page_number: Number(payload.page_number || 0) + 1, next_url: data.next || null };
    let currentSectionId = nextPayload.current_section_id == null ? null : Number(nextPayload.current_section_id);
    let sectionPosition = Number(nextPayload.section_position || 0);
    let lecturePosition = Number(nextPayload.lecture_position || 0);
    let pendingTitle = String(nextPayload.pending_section_title || "Introduction");
    let lectureCount = Number(nextPayload.lecture_count || 0);
    for (const item of items) {
      if (item._class === "chapter") {
        pendingTitle = item.title || `Section ${sectionPosition + 1}`;
        currentSectionId = null;
      } else if (item._class === "lecture") {
        if (currentSectionId == null) {
          sectionPosition++;
          let sectionRow = await database.prepare("SELECT id FROM sections WHERE course_id=? AND position=?").bind(nextPayload.local_course_id, sectionPosition).first<Row>();
          if (sectionRow) await database.prepare("UPDATE sections SET title=? WHERE id=?").bind(pendingTitle, sectionRow.id).run();
          else {
            const inserted = await database.prepare("INSERT INTO sections (course_id,title,position) VALUES (?,?,?)").bind(nextPayload.local_course_id, pendingTitle, sectionPosition).run();
            sectionRow = { id: inserted.meta.last_row_id };
          }
          currentSectionId = Number(sectionRow.id);
          lecturePosition = 0;
        }
        lecturePosition++;
        const asset = item.asset || {};
        const lectureId = String(item.id);
        const title = item.title || `Lecture ${lecturePosition}`;
        const type = String(asset.asset_type || item.asset_type || "video").toLowerCase().includes("video") ? "video" : "article";
        const duration = Number(asset.time_estimation || item.time_estimation || asset.length || 0);
        const captions = JSON.stringify(asset.captions || asset.subtitles || []);
        const lectureUrl = `${String(nextPayload.canonical_url).replace(/\/$/, "")}/learn/lecture/${lectureId}`;
        const existingLecture = await database.prepare(`SELECT l.id FROM lectures l JOIN sections s ON s.id=l.section_id WHERE s.course_id=? AND l.lecture_id=?`)
          .bind(nextPayload.local_course_id, lectureId).first<Row>();
        if (existingLecture) await database.prepare(`UPDATE lectures SET section_id=?,title=?,url=?,lecture_type=?,duration=?,position=?,captions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(currentSectionId, title, lectureUrl, type, duration, lecturePosition, captions, existingLecture.id).run();
        else await database.prepare(`INSERT INTO lectures (section_id,lecture_id,title,url,lecture_type,duration,position,learning_status,captions_json) VALUES (?,?,?,?,?,?,?,'NOT_STARTED',?)`)
          .bind(currentSectionId, lectureId, title, lectureUrl, type, duration, lecturePosition, captions).run();
        lectureCount++;
      }
    }
    nextPayload = { ...nextPayload, current_section_id: currentSectionId, section_position: sectionPosition,
      lecture_position: lecturePosition, pending_section_title: pendingTitle, lecture_count: lectureCount };
    if (data.next) {
      await saveStep(nextPayload, `Curriculum page ${nextPayload.page_number}: ${lectureCount} lectures imported so far.`);
    } else if (items.length || nextPayload.has_curriculum) {
      await saveStep({ ...nextPayload, stage: "write_complete" }, `Curriculum complete: ${lectureCount} lectures in ${sectionPosition} sections. Finishing import.`);
    } else {
      const nextEndpoint = endpointIndex + 1;
      await saveStep({ ...nextPayload, next_url: null, host_index: nextEndpoint < endpoints.length ? hostIndex : hostIndex + 1,
        endpoint_index: nextEndpoint < endpoints.length ? nextEndpoint : 0 }, `Trying another Udemy curriculum endpoint for ${payload.title}.`);
    }
  } catch (error) {
    await retryJob(job, error);
  }
}

async function api(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method.toUpperCase();
  if (!path.length && method === "GET") return json({ service: "Udemy Subtitle Manager API", runtime: "ChatGPT Sites Worker" });
  if (path[0] === "health" && method === "GET") {
    const [dispatcher, queue] = await Promise.all([
      db().prepare("SELECT * FROM dispatcher_status WHERE id=1").first<Row>(),
      db().prepare(`SELECT MIN(CASE WHEN retry_at IS NULL OR retry_at<=unixepoch() THEN created_at END) AS oldest_queued_at,
        SUM(CASE WHEN status IN ('PENDING','PROCESSING') THEN 1 ELSE 0 END) AS active_jobs,
        SUM(CASE WHEN retry_at IS NULL OR retry_at<=unixepoch() THEN 1 ELSE 0 END) AS runnable_jobs,
        SUM(CASE WHEN (retry_at IS NULL OR retry_at<=unixepoch()) AND updated_at<=datetime('now','-15 minutes') THEN 1 ELSE 0 END) AS overdue_runnable_jobs
        FROM processing_jobs WHERE status IN ('PENDING','PROCESSING')`).first<Row>(),
    ]);
    const heartbeatAgeMs = dispatcher?.heartbeat_at ? Date.now() - Date.parse(`${dispatcher.heartbeat_at}Z`) : Infinity;
    const stale = !Number.isFinite(heartbeatAgeMs) || heartbeatAgeMs > 15 * 60_000;
    const dispatcherFailed = dispatcher?.status === "FAILED";
    const overdueRunnableJobs = Number(queue?.overdue_runnable_jobs || 0);
    const activeJobs = Number(queue?.active_jobs || 0);
    const degraded = (stale && activeJobs > 0) || dispatcherFailed || overdueRunnableJobs > 0;
    const staleReason = !dispatcher?.heartbeat_at || !Number.isFinite(heartbeatAgeMs) ? "No valid dispatcher heartbeat has been recorded." : stale
      ? dispatcher.status === "RUNNING" ? "The running dispatcher heartbeat is older than 15 minutes."
        : "The last dispatcher heartbeat is older than 15 minutes; run the manual hosted dispatcher to resume queued work."
      : null;
    return json({ status: degraded ? "degraded" : "ok", commit: releaseCommit,
      dispatcher: dispatcher ? { status: dispatcher.status, heartbeat_at: dispatcher.heartbeat_at,
        last_started_at: dispatcher.last_started_at, last_finished_at: dispatcher.last_finished_at,
        advanced: Number(dispatcher.advanced || 0), error: dispatcher.error_message ?? null,
        stale, stale_reason: staleReason, stalled: dispatcher.status === "RUNNING" && stale } : {
          status: "NEVER_RUN", heartbeat_at: null, last_started_at: null, last_finished_at: null,
          advanced: 0, error: null, stale: true, stale_reason: staleReason, stalled: false,
        },
      queue: { oldest_queued_at: queue?.oldest_queued_at ?? null,
        oldest_queued_age_seconds: queue?.oldest_queued_at ? Math.max(0, Math.floor(Date.now() / 1000 - Date.parse(`${queue.oldest_queued_at}Z`) / 1000)) : 0,
        active_jobs: activeJobs, runnable_jobs: Number(queue?.runnable_jobs || 0), overdue_runnable_jobs: overdueRunnableJobs,
        stalled_jobs: overdueRunnableJobs },
    });
  }
  if (path[0] === "drive" && path[1] === "callback" && method === "GET") return driveCallback(request, url);

  if (path.join("/") === "internal/jobs/run" && method === "POST") {
    const secret = (env as any).JOB_RUNNER_SECRET;
    if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) return fail("Unauthorized",401);
    const database = db();
    const runId = crypto.randomUUID();
    await database.prepare(`INSERT INTO dispatcher_status(id,run_id,status,last_started_at,heartbeat_at,advanced,error_message) VALUES(1,?,'RUNNING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,NULL)
      ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,status='RUNNING',last_started_at=CURRENT_TIMESTAMP,heartbeat_at=CURRENT_TIMESTAMP,advanced=0,error_message=NULL`).bind(runId).run();
    try {
      await migrateDriveCredentials();
      const users = await database.prepare("SELECT DISTINCT user_id FROM processing_jobs WHERE status IN ('PENDING','PROCESSING') AND (retry_at IS NULL OR retry_at <= unixepoch()) ORDER BY updated_at LIMIT 8").all<Row>();
      let advanced = 0;
      for (const row of users.results) {
        if (await processPendingJob(Number(row.user_id))) advanced++;
        await database.prepare("UPDATE dispatcher_status SET heartbeat_at=CURRENT_TIMESTAMP,advanced=? WHERE id=1 AND run_id=?").bind(advanced,runId).run();
      }
      await database.prepare("UPDATE dispatcher_status SET status='SUCCEEDED',heartbeat_at=CURRENT_TIMESTAMP,last_finished_at=CURRENT_TIMESTAMP,advanced=? WHERE id=1 AND run_id=?").bind(advanced,runId).run();
      return json({advanced,run_id:runId});
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0,500) : "Dispatcher failed.";
      await database.prepare("UPDATE dispatcher_status SET status='FAILED',heartbeat_at=CURRENT_TIMESTAMP,last_finished_at=CURRENT_TIMESTAMP,error_message=? WHERE id=1 AND run_id=?").bind(detail,runId).run();
      throw error;
    }
  }
  if (path.join("/") === "internal/jobs/failed" && method === "POST") {
    const secret = (env as any).JOB_RUNNER_SECRET;
    if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) return fail("Unauthorized",401);
    const payload = await bodyJson(request);
    const detail = typeof payload.error === "string" ? payload.error.slice(0,500) : "Dispatcher request failed.";
    await db().prepare(`INSERT INTO dispatcher_status(id,run_id,status,last_started_at,heartbeat_at,last_finished_at,advanced,error_message)
      VALUES(1,?,'FAILED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,?)
      ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,status='FAILED',heartbeat_at=CURRENT_TIMESTAMP,last_finished_at=CURRENT_TIMESTAMP,error_message=excluded.error_message`)
      .bind(crypto.randomUUID(),detail).run();
    return json({recorded:true});
  }
  const user = await currentUser(request, path);
  if (path[0] === "auth" && path[1] === "me" && method === "GET") return json(await apiUserProfile(user));
  if (path[0] === "auth" && path[1] === "logout" && method === "POST") return json({ message: "Signed out from ChatGPT." });
  if (path[0] === "auth" && ["login", "register"].includes(path[1] || "")) return fail("This Site uses your ChatGPT sign-in; account passwords are managed by ChatGPT.", 410);
  if (path[0] === "udemy") return udemyRoutes(request, user, path.slice(1), url);
  if (path[0] === "drive") return driveRoutes(request, user, path.slice(1), url);
  if (path[0] === "courses") return courseRoutes(request, user, path.slice(1), url);
  if (path[0] === "subtitles") {
    if (method === "POST" && path[3] === "upload") {
      const token=crypto.randomUUID();
      const claim=await db().prepare(`INSERT INTO job_leases(user_id,token,expires_at) VALUES (?,?,unixepoch()+600)
        ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE job_leases.expires_at<unixepoch()`).bind(user.id,token).run();
      if (!claim.meta.changes) throw new ApiError(409,"Processing is active. Retry subtitle import shortly.");
      try { await assertNoCleanup(user.id); return await subtitleRoutes(request,user,path.slice(1),url); }
      finally { await db().prepare("DELETE FROM job_leases WHERE user_id=? AND token=?").bind(user.id,token).run(); }
    }
    return subtitleRoutes(request,user,path.slice(1),url);
  }
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
