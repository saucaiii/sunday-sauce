import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { envBool, envNum } from "./env.js";

/**
 * A small OBS WebSocket (v5) client, so the control page can run the switcher.
 *
 * The overlay server already runs beside OBS on the same Mac, which makes it
 * the natural place to drive OBS from: the rundown lives here, so a press of
 * Next can move the rundown and cut to that segment's scene in one step,
 * instead of the host doing both mid-sentence.
 *
 * Node 22 ships a WebSocket client, so this needs no dependency. It only does
 * what the show needs: list scenes, cut to one, and notice when an ad ends.
 *
 * OBS being closed is the normal state outside a show, so this never throws
 * and never spams the log: it retries quietly and reports its state through
 * status(), which the control page displays.
 */

const RETRY_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;

/** obs-websocket event subscription bits: Scenes and MediaInputs. */
const SUBSCRIBE = (1 << 2) | (1 << 8);

const MEDIA_KINDS = new Set(["ffmpeg_source", "vlc_source"]);

/**
 * Where OBS keeps its own WebSocket settings. Reading the password from here
 * means it lives in one place: turning the server on in OBS is the whole setup.
 */
const OBS_WS_CONFIG = path.join(
  os.homedir(), "Library", "Application Support", "obs-studio",
  "plugin_config", "obs-websocket", "config.json",
);

export interface ObsStatus {
  /** Off means the integration is disabled in .env, not that OBS is closed. */
  enabled: boolean;
  connected: boolean;
  /** Why it is not connected, in words the control page can show as is. */
  reason: string;
  program: string;
  /** Top of the OBS list first, which is the order the operator sees there. */
  scenes: string[];
  /** Where the show goes back to when the ad on air finishes. */
  returnTo: string;
}

interface Pending {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let ws: WebSocket | null = null;
let connected = false;
let reason = "not started";
let program = "";
let scenes: string[] = [];
let returnTo = "";
let started = false;
/** Set just before closing on purpose, so the close handler reports why. */
let closeReason = "";
let nextId = 1;
const pending = new Map<string, Pending>();
/** Media inputs per scene, filled on first use. Empty set means "not an ad scene". */
const mediaByScene = new Map<string, Set<string>>();

function enabled(): boolean {
  return envBool("OBS_CONTROL", true);
}

function settings(): { url: string; password: string; serverEnabled: boolean | null } {
  let fromFile: Record<string, unknown> = {};
  try {
    fromFile = JSON.parse(fs.readFileSync(OBS_WS_CONFIG, "utf8"));
  } catch {
    // No file just means OBS has never opened its WebSocket settings.
  }
  const port = envNum("OBS_WS_PORT", Number(fromFile.server_port) || 4455);
  return {
    url: process.env.OBS_WS_URL?.trim() || `ws://127.0.0.1:${port}`,
    password: process.env.OBS_WS_PASSWORD ?? String(fromFile.server_password ?? ""),
    serverEnabled: typeof fromFile.server_enabled === "boolean" ? fromFile.server_enabled : null,
  };
}

function sha256b64(s: string): string {
  return crypto.createHash("sha256").update(s).digest("base64");
}

/** The v5 handshake: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export function authString(password: string, salt: string, challenge: string): string {
  return sha256b64(sha256b64(password + salt) + challenge);
}

function setReason(r: string): void {
  if (r !== reason) console.log(`[OBS] ${r}`);
  reason = r;
}

function send(op: number, d: Record<string, unknown>): void {
  ws?.send(JSON.stringify({ op, d }));
}

function request(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!ws || !connected) return Promise.reject(new Error("OBS is not connected"));
  const requestId = String(nextId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`OBS did not answer ${requestType}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    send(6, { requestType, requestId, requestData });
  });
}

async function refreshScenes(): Promise<void> {
  const d = await request("GetSceneList");
  const list = (d.scenes as Array<{ sceneName: string; sceneIndex: number }>) ?? [];
  // OBS numbers from the bottom of its list; reverse so the page reads top-down.
  scenes = [...list].sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName);
  program = String(d.currentProgramSceneName ?? program);
  mediaByScene.clear();
}

async function mediaIn(scene: string): Promise<Set<string>> {
  const known = mediaByScene.get(scene);
  if (known) return known;
  const d = await request("GetSceneItemList", { sceneName: scene });
  const items = (d.sceneItems as Array<{ sourceName: string; inputKind?: string }>) ?? [];
  const found = new Set(items.filter((i) => MEDIA_KINDS.has(i.inputKind ?? "")).map((i) => i.sourceName));
  mediaByScene.set(scene, found);
  return found;
}

/**
 * Decides where to return after an ad.
 *
 * Entering a scene that plays media remembers the scene it came from, unless
 * that was itself an ad scene (two ads back to back return to the show, not to
 * the first ad). Entering anything else clears it: once the operator has cut
 * away by hand, a late "ended" must not yank the show somewhere else.
 */
export function nextReturnTo(prev: string, prevIsAd: boolean, enteringAd: boolean, existing: string): string {
  if (!enteringAd) return "";
  return prevIsAd ? existing : prev;
}

async function onProgramChanged(scene: string): Promise<void> {
  const prev = program;
  program = scene;
  if (!prev || prev === scene) return;
  try {
    const [prevMedia, nowMedia] = await Promise.all([mediaIn(prev), mediaIn(scene)]);
    returnTo = nextReturnTo(prev, prevMedia.size > 0, nowMedia.size > 0, returnTo);
  } catch {
    returnTo = "";
  }
}

async function onMediaEnded(input: string): Promise<void> {
  if (!envBool("OBS_AUTO_RETURN", true) || !returnTo) return;
  const media = await mediaIn(program).catch(() => new Set<string>());
  // Only the ad on air counts. A clip ending in a scene nobody is watching
  // must not cut the live show.
  if (!media.has(input)) return;
  const target = returnTo;
  returnTo = "";
  console.log(`[OBS] "${input}" ended, back to ${target}`);
  await request("SetCurrentProgramScene", { sceneName: target }).catch((e) =>
    console.error("[OBS] could not return to %s:", target, (e as Error).message));
}

function onMessage(raw: string): void {
  let msg: { op: number; d: Record<string, any> };
  try { msg = JSON.parse(raw); } catch { return; }
  const d = msg.d ?? {};

  if (msg.op === 0) {
    const { password } = settings();
    const auth = d.authentication as { challenge: string; salt: string } | undefined;
    if (auth && !password) {
      closeReason = "OBS wants a password and none was found";
      ws?.close();
      return;
    }
    send(1, {
      rpcVersion: 1,
      eventSubscriptions: SUBSCRIBE,
      ...(auth ? { authentication: authString(password, auth.salt, auth.challenge) } : {}),
    });
  } else if (msg.op === 2) {
    connected = true;
    setReason("connected");
    refreshScenes().catch((e) => console.error("[OBS] scene list:", (e as Error).message));
  } else if (msg.op === 5) {
    const ev = d.eventType as string;
    const data = (d.eventData ?? {}) as Record<string, string>;
    if (ev === "CurrentProgramSceneChanged") void onProgramChanged(data.sceneName);
    else if (ev === "SceneListChanged") void refreshScenes().catch(() => {});
    else if (ev === "MediaInputPlaybackEnded") void onMediaEnded(data.inputName);
  } else if (msg.op === 7) {
    const p = pending.get(d.requestId);
    if (!p) return;
    pending.delete(d.requestId);
    clearTimeout(p.timer);
    if (d.requestStatus?.result) p.resolve(d.responseData ?? {});
    else p.reject(new Error(d.requestStatus?.comment || `OBS refused ${d.requestType}`));
  }
}

function connect(): void {
  if (!enabled()) { setReason("disabled in .env (OBS_CONTROL)"); return; }
  const { url, serverEnabled } = settings();

  let sock: WebSocket;
  try {
    sock = new WebSocket(url);
  } catch (e) {
    setReason(`bad OBS_WS_URL: ${(e as Error).message}`);
    return;
  }
  ws = sock;

  // Node's WebSocket fires only "error", never "close", when the connection is
  // refused, so both lead here and the first one owns the retry.
  const down = (code: number) => {
    if (ws !== sock) return;
    ws = null;
    connected = false;
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error("OBS disconnected")); }
    pending.clear();
    // 4009 is obs-websocket's "authentication failed".
    if (closeReason) setReason(closeReason);
    else if (code === 4009) setReason("OBS rejected the password");
    else if (serverEnabled === false) setReason("OBS WebSocket server is off (Tools → WebSocket Server Settings)");
    else setReason("OBS is not running, or its WebSocket server is off");
    closeReason = "";
    try { sock.close(); } catch { /* already closed */ }
    setTimeout(connect, RETRY_MS);
  };

  sock.addEventListener("message", (e) => onMessage(String(e.data)));
  sock.addEventListener("close", (e) => down(e.code));
  sock.addEventListener("error", () => down(0));
}

export function start(): void {
  if (started) return;
  started = true;
  connect();
}

export function status(): ObsStatus {
  return { enabled: enabled(), connected, reason, program, scenes, returnTo };
}

/**
 * Finds a scene by name or by its number prefix, so the rundown can say "@07"
 * rather than spelling out "07 Screen + Host" with its em dash and plus sign.
 */
export function resolveScene(want: string, list: string[]): string | null {
  const w = want.trim().toLowerCase();
  if (!w) return null;
  const exact = list.find((s) => s.toLowerCase() === w);
  if (exact) return exact;
  const prefixed = list.filter((s) => s.toLowerCase().startsWith(w + " "));
  return prefixed.length === 1 ? prefixed[0] : null;
}

/** Cuts the program output to a scene. Resolves to the scene name used. */
export async function switchTo(want: string): Promise<string> {
  if (!connected) throw new Error("OBS is not connected");
  const scene = resolveScene(want, scenes);
  if (!scene) throw new Error(`No OBS scene matches "${want}"`);
  await request("SetCurrentProgramScene", { sceneName: scene });
  return scene;
}
