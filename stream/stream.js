// Event Pal private streams — shared by the streamer page (index.html) and the viewer page (watch.html).
// Video goes straight from the streamer's phone to each viewer (WebRTC), or through the Cloudflare relay
// once more people join. Who may watch is decided in the Restaurant Pal database; the live channel that
// carries connection messages is private to the streamer and viewers who've been let in.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const SB_URL = "https://qpctzuwveswsstzhjrfn.supabase.co";
const SB_KEY = "sb_publishable_InfPSFhR8XYevv4cQB7IVQ_6nLXuw5x"; // public by design; the database rules protect the data
export const TEST = new URLSearchParams(location.search).has("test");
// In ?test each tab is its own person (separate sign-in and device), so one browser can play streamer and viewers.
const store = TEST ? sessionStorage : localStorage;
export const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, storageKey: "ep-stream-auth", storage: store } });
export const DIRECT_MAX = 3;           // viewers fed straight from the phone before switching to the relay
export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const params = () => new URLSearchParams(location.hash.slice(1) || location.search.slice(1));

export async function signIn() {
  let { data } = await sb.auth.getSession();
  if (!data.session) { const r = await sb.auth.signInAnonymously(); if (r.error) throw new Error("Couldn't connect. Check your internet and reload."); data = { session: r.data.session }; }
  await sb.realtime.setAuth(data.session.access_token);
  sb.auth.onAuthStateChange((_e, s) => { if (s?.access_token) sb.realtime.setAuth(s.access_token); });
  return data.session.user.id;
}
export function deviceId() {
  let d = store.getItem("ep-stream-device");
  if (!d) { d = crypto.randomUUID(); store.setItem("ep-stream-device", d); }
  return d;
}
export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/, ""));
  if (data && data.error) throw new Error(data.error);
  return data;
}
export async function fn(action, body, raw) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SB_URL}/functions/v1/stream-relay`, {
    method: "POST", headers: { Authorization: `Bearer ${session?.access_token}`, apikey: SB_KEY, "x-action": action, "Content-Type": raw ? "application/octet-stream" : "application/json" },
    body: raw || JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}
let ICE = null;
export async function iceServers() { if (!ICE) { try { ICE = (await fn("ice")).iceServers; } catch { ICE = [{ urls: "stun:stun.l.google.com:19302" }]; } } return ICE; }
export const gathered = (pc, ms = 2500) => new Promise((ok) => {
  if (pc.iceGatheringState === "complete") return ok();
  const t = setTimeout(ok, ms); pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); ok(); } });
});

// The private live channel for one stream. on(msg) gets every message addressed to `me`, to everyone, or to `alias`
// (the streamer is "host"). If the channel drops after joining, it rejoins by itself.
export function channel(streamId, me, on, alias) {
  if (TEST) window.__chlog = window.__chlog || [];
  let ch, closed = false, first = true, okFirst, badFirst;
  const ready = new Promise((ok, bad) => { okFirst = ok; badFirst = bad; });
  const open = () => {
    ch = sb.channel(`stream:${streamId}`, { config: { private: true, broadcast: { self: false } } });
    ch.on("broadcast", { event: "m" }, ({ payload }) => { if (!payload.to || payload.to === me || payload.to === "*" || (alias && payload.to === alias)) on(payload); });
    const mine = ch;
    ch.subscribe((s, err) => {
      if (TEST) window.__chlog.push(`${new Date().toISOString().slice(11, 19)} ${s} ${err?.message || ""}`);
      if (s === "SUBSCRIBED") { if (first) { first = false; okFirst(); } return; }
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        if (first) { first = false; badFirst(err || new Error(s)); return; }
        if (!closed && mine === ch) { sb.removeChannel(mine); setTimeout(() => { if (!closed) open(); }, 1000); }
      }
    });
  };
  open();
  return {
    ready,
    send: (m) => ch.send({ type: "broadcast", event: "m", payload: { ...m, from: me } }),
    close: () => { closed = true; sb.removeChannel(ch); },
  };
}

// Upload test: sends 1 MB and times it. Returns megabits per second.
export async function uploadSpeed() {
  const data = new Uint8Array(1_000_000); crypto.getRandomValues(data.subarray(0, 65536));
  const t = performance.now(); await fn("speed", null, data);
  return (8 * data.length / 1e6) / ((performance.now() - t) / 1000);
}

// A moving test picture and tone, for ?test (no camera needed).
export function testStream(label) {
  const c = Object.assign(document.createElement("canvas"), { width: 640, height: 360 }), g = c.getContext("2d"); let n = 0;
  setInterval(() => { n++; g.fillStyle = `hsl(${n % 360} 60% 25%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = "#fff"; g.font = "bold 40px sans-serif";
    g.fillText(label, 30, 80); g.fillText(new Date().toLocaleTimeString(), 30, 150); g.fillRect(30 + (n * 6) % 560, 220, 50, 50); }, 66);
  const s = c.captureStream(15);
  try { const a = new AudioContext(), o = a.createOscillator(), d = a.createMediaStreamDestination(), v = a.createGain(); v.gain.value = 0.02; o.connect(v).connect(d); o.start(); s.addTrack(d.stream.getAudioTracks()[0]); } catch { /* no audio */ }
  return s;
}
