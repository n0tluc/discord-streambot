import { WebSocket } from "ws";
(global as any).WebSocket = WebSocket;

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const InviteFlags = require("discord.js-selfbot-v13/src/util/InviteFlags.js");
InviteFlags.FLAGS.GUEST = InviteFlags.FLAGS.IS_GUEST_INVITE;

import { Client } from "discord.js-selfbot-v13";
import {
  Streamer,
  prepareStream,
  playStream,
  Utils,
  Encoders,
} from "@dank074/discord-video-stream";
import { readFileSync, existsSync } from "node:fs";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Library-Bug: WebRTC-Peer-Connection-Race bei Stream-Stop/-Neustart.
// handleProtocolAck() kann auf einer bereits zerstörten Verbindung laufen.
process.on("uncaughtException", (err: Error) => {
  if (err.message?.includes("destroyed peer connection") || err.message?.includes("setRemoteDescription")) {
    console.warn("[WebRTC] Ignoriere bekannten Library-Bug:", err.message);
    return;
  }
  console.error("[Uncaught Exception]", err);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[Unhandled Rejection]", reason);
});

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Config {
  token: string;
  prefix: string;
  acceptedAuthors: string[];
  height: number;
  fps: number;
  bitrateVideo: number;
  bitrateVideoMax: number;
  videoCodec: string;
  includeAudio: boolean;
}

interface StreamSettings {
  height: number;
  fps: number;
  bitrateVideo: number;
  bitrateVideoMax: number;
}

interface QueueItem {
  url: string;
  type: "go-live" | "camera";
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

// URLs (oder Teilstrings) die automatisch den Fußball-Liveticker aktivieren
const FOOTBALL_STREAM_URLS: string[] = [
  "38600_10301",   // Fritz!Box Fußball-Kanal
];

const QUALITY_PRESETS: Record<string, StreamSettings> = {
  "360p":    { height: 360,  fps: 30, bitrateVideo: 1000,  bitrateVideoMax: 1500  },
  "480p":    { height: 480,  fps: 30, bitrateVideo: 2500,  bitrateVideoMax: 3500  },
  "720p":    { height: 720,  fps: 30, bitrateVideo: 3000,  bitrateVideoMax: 4500  },
  "720p50":  { height: 720,  fps: 50, bitrateVideo: 4000,  bitrateVideoMax: 5500  },
  "720p60":  { height: 720,  fps: 60, bitrateVideo: 4500,  bitrateVideoMax: 6000  },
  "1080p":   { height: 1080, fps: 30, bitrateVideo: 5000,  bitrateVideoMax: 7500  },
  "1080p50": { height: 1080, fps: 50, bitrateVideo: 7000,  bitrateVideoMax: 10000 },
  "1080p60": { height: 1080, fps: 60, bitrateVideo: 8000,  bitrateVideoMax: 12000 },
  "4k":      { height: 2160, fps: 30, bitrateVideo: 20000, bitrateVideoMax: 30000 },
};

// ─── Konfiguration ────────────────────────────────────────────────────────────

const config: Config = JSON.parse(
  readFileSync(join(__dirname, "../config.json"), "utf-8")
);

// ─── Laufzeit-Zustand ─────────────────────────────────────────────────────────

let currentSettings: StreamSettings = {
  height:          config.height,
  fps:             config.fps,
  bitrateVideo:    config.bitrateVideo,
  bitrateVideoMax: config.bitrateVideoMax,
};

let currentCommand: any       = null;
let currentPreMux: ChildProcess | null = null;
let isStreaming                = false;
let stopRequested          = false;
let lastStreamUrl: string | null          = null;
let lastStreamType: "go-live" | "camera" | null = null;
let currentVolume          = 100;
let loopEnabled            = false;
let seekPosition: string | null = null;
const videoQueue: QueueItem[] = [];

// Fußball-Liveticker
let tickerInterval: ReturnType<typeof setInterval> | null = null;
let tickerEnabled  = false;

// ─── Streamer ─────────────────────────────────────────────────────────────────

const streamer = new Streamer(new Client());

streamer.client.on("ready", () => {
  console.log(`[Bot] Eingeloggt als ${streamer.client.user?.tag}`);
  console.log(`[Bot] Präfix: "${config.prefix}"`);
  console.log(`[Bot] Akzeptierte IDs: ${config.acceptedAuthors.join(", ")}`);
  console.log(`[Bot] Bereit! Sende "${config.prefix}help" für alle Befehle.`);
});

// ─── Nachrichten-Handler ──────────────────────────────────────────────────────

streamer.client.on("messageCreate", async (message: any) => {
  if (!config.acceptedAuthors.includes(message.author.id)) return;
  if (!message.content.startsWith(config.prefix)) return;
  if (!message.guildId) return;

  const parts = message.content.slice(config.prefix.length).trim().split(/\s+/);
  const cmd   = parts.shift()?.toLowerCase() ?? "";
  const args  = parts;

  try {
    switch (cmd) {

      // ── Voice ──────────────────────────────────────────────────────────────

      case "join": {
        const channelId = args[0] ?? message.member?.voice?.channelId;
        if (!channelId) {
          message.reply(`❌ Tritt einem Voice-Kanal bei oder gib eine ID an:\n\`${config.prefix}join <channel_id>\``);
          return;
        }
        await streamer.joinVoice(message.guildId, channelId);
        message.reply("✅ Voice-Kanal beigetreten!");
        break;
      }

      case "leave": {
        await stopCurrentStream();
        try { streamer.leaveVoice(); } catch (_) {}
        message.reply("👋 Voice-Kanal verlassen!");
        break;
      }

      case "invite":
      case "joinserver": {
        const inviteInput = args[0];
        if (!inviteInput) {
          message.reply(`❌ Invite-Link oder Code fehlt!\nBsp: \`${config.prefix}invite https://discord.gg/xxxxx\``);
          return;
        }
        const code = extractInviteCode(inviteInput);
        try {
          message.reply(`📥 Versuche dem Server beizutreten (Code: \`${code}\`)...`);
          const guild = await streamer.client.acceptInvite(code, { bypassOnboarding: false, bypassVerify: false });
          const name = guild && typeof guild === "object" && 'name' in guild ? (guild as any).name : `Server mit Code ${code}`;
          message.reply(`✅ Erfolgreich beigetreten: **${name}**`);
        } catch (err) {
          console.error("[Invite Fehler]", err);
          message.reply(`❌ Fehler beim Beitreten des Servers: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      // ── Wiedergabe ─────────────────────────────────────────────────────────

      case "play":
      case "live": {
        const url = args.join(" ");
        if (!url) {
          message.reply(`❌ URL fehlt!\nBsp: \`${config.prefix}play https://example.com/video.mp4\``);
          return;
        }
        await stopCurrentStream();
        message.reply(`▶️ Go-Live Stream wird gestartet...${seekInfo()}`);
        startStream(url, "go-live").catch(err => console.error("[Stream]", err));
        break;
      }

      case "cam": {
        const url = args.join(" ");
        if (!url) {
          message.reply(`❌ URL fehlt!\nBsp: \`${config.prefix}cam https://example.com/video.mp4\``);
          return;
        }
        await stopCurrentStream();
        message.reply(`📹 Kamera-Stream wird gestartet...${seekInfo()}`);
        startStream(url, "camera").catch(err => console.error("[Stream]", err));
        break;
      }

      case "stop": {
        if (!isStreaming) {
          message.reply("❌ Kein aktiver Stream!");
          return;
        }
        await stopCurrentStream();
        message.reply("⏹️ Stream gestoppt!");
        break;
      }

      case "replay":
      case "r": {
        if (!lastStreamUrl || !lastStreamType) {
          message.reply("❌ Kein vorheriger Stream vorhanden!");
          return;
        }
        await stopCurrentStream();
        message.reply(`🔁 Stream wird wiederholt...${seekInfo()}`);
        startStream(lastStreamUrl, lastStreamType).catch(err => console.error("[Stream]", err));
        break;
      }

      // ── Lautstärke ─────────────────────────────────────────────────────────

      case "volume":
      case "vol":
      case "v": {
        const val = Number(args[0]);
        if (args.length === 0) {
          message.reply(`🔊 Lautstärke: **${currentVolume}%**\nÄndern: \`${config.prefix}volume <0-200>\``);
          return;
        }
        if (isNaN(val) || val < 0 || val > 200) {
          message.reply("❌ Lautstärke muss zwischen **0** und **200** liegen!");
          return;
        }
        currentVolume = val;
        const emoji = val === 0 ? "🔇" : val < 50 ? "🔈" : val < 120 ? "🔉" : "🔊";
        message.reply(`${emoji} Lautstärke auf **${val}%** gesetzt.${activeStreamHint()}`);
        break;
      }

      // ── Seek ───────────────────────────────────────────────────────────────

      case "seek": {
        const time = args[0];
        if (!time || time === "reset" || time === "0") {
          seekPosition = null;
          message.reply("⏱️ Seek-Position zurückgesetzt (startet von Anfang).");
          return;
        }
        if (!/^(\d+:)?(\d{1,2}:)?\d{1,2}(\.\d+)?$/.test(time) && isNaN(Number(time))) {
          message.reply(
            "❌ Ungültiges Format!\n" +
            "Bsp: `01:30:00` · `1:30` · `90` (Sekunden)\n" +
            `Reset: \`${config.prefix}seek reset\``
          );
          return;
        }
        seekPosition = isNaN(Number(time)) ? time : String(Number(time));
        message.reply(
          `⏩ Seek auf **${formatSeek(seekPosition)}** gesetzt.\n` +
          `Gilt beim nächsten \`${config.prefix}play\` / \`${config.prefix}replay\`.`
        );
        break;
      }

      // ── Loop ───────────────────────────────────────────────────────────────

      case "loop": {
        loopEnabled = !loopEnabled;
        message.reply(loopEnabled
          ? "🔂 Loop **aktiviert** — Video wiederholt sich automatisch."
          : "➡️ Loop **deaktiviert**."
        );
        break;
      }

      // ── Queue ──────────────────────────────────────────────────────────────

      case "queue":
      case "q": {
        await handleQueueCommand(args, message);
        break;
      }

      // Kurzformen für Queue
      case "qa": { args.unshift("add");  await handleQueueCommand(args, message); break; }
      case "ql": { await handleQueueCommand(["list"],  message); break; }
      case "qc": { await handleQueueCommand(["clear"], message); break; }
      case "qs": { await handleQueueCommand(["skip"],  message); break; }

      // ── Fußball-Ticker ─────────────────────────────────────────────────────

      case "ticker": {
        const leagueArg = args[0]?.toLowerCase();
        const p = config.prefix;

        if (leagueArg === "list") {
          const lines = Object.entries(TICKER_LEAGUES)
            .filter(([k]) => !["bl", "wm2026"].includes(k)) // Duplikate ausblenden
            .map(([k, v]) => `\`${p}ticker ${k}\` — ${v.label}`);
          message.reply("**⚽ Ticker-Ligen:**\n" + lines.join("\n"));
          break;
        }

        if (leagueArg && TICKER_LEAGUES[leagueArg]) {
          await startFootballTicker(leagueArg);
          const current = await fetchBundesligaTicker();
          message.reply(current
            ? `✅ Ticker **${TICKER_LEAGUES[leagueArg].label}**: ${current}`
            : `✅ Ticker **${TICKER_LEAGUES[leagueArg].label}** aktiv — gerade keine Livespiele.`
          );
          break;
        }

        if (tickerEnabled) {
          stopFootballTicker();
          message.reply("⏹️ Liveticker gestoppt.");
        } else {
          await startFootballTicker();
          const current = await fetchBundesligaTicker();
          message.reply(current
            ? `✅ Ticker aktiv (${TICKER_LEAGUES[tickerLeague]?.label}): ${current}`
            : `✅ Ticker aktiv — keine Livespiele gerade (\`${p}ticker list\` für alle Ligen).`
          );
        }
        break;
      }

      // ── Quality ────────────────────────────────────────────────────────────

      case "quality": {
        await handleQualityCommand(args, message);
        break;
      }

      // ── Info ───────────────────────────────────────────────────────────────

      case "np": {
        if (!lastStreamUrl) {
          message.reply("⚫ Kein Stream aktiv oder zuletzt gespielt.");
          return;
        }
        const s = currentSettings;
        const urlDisplay = lastStreamUrl.length > 60
          ? lastStreamUrl.slice(0, 57) + "..."
          : lastStreamUrl;
        message.reply(
          `**🎬 Jetzt läuft:**\n` +
          `\`${urlDisplay}\`\n\n` +
          `Modus: **${lastStreamType === "go-live" ? "Go-Live" : "Kamera"}** · ` +
          `Status: **${isStreaming ? "🔴 Läuft" : "⚫ Gestoppt"}**\n` +
          `Qualität: **${s.height}p** · **${s.fps} FPS** · **${s.bitrateVideo} kbps**\n` +
          `Lautstärke: **${currentVolume}%** · ` +
          `Loop: **${loopEnabled ? "An" : "Aus"}** · ` +
          `Queue: **${videoQueue.length}** Video(s)\n` +
          (seekPosition ? `Seek: **${formatSeek(seekPosition)}**` : "")
        );
        break;
      }

      case "status": {
        const s = currentSettings;
        message.reply(
          `📊 **Status:** ${isStreaming ? "🔴 Läuft" : "⚫ Inaktiv"} · ` +
          `Loop: ${loopEnabled ? "🔂 An" : "Aus"} · ` +
          `Queue: ${videoQueue.length} Video(s)\n` +
          `🎨 **Qualität:** ${s.height}p · ${s.fps} FPS · ${s.bitrateVideo} kbps\n` +
          `🔊 **Lautstärke:** ${currentVolume}%` +
          (seekPosition ? `\n⏩ **Seek:** ${formatSeek(seekPosition)}` : "")
        );
        break;
      }

      case "help": {
        const p = config.prefix;
        message.reply(
          "**🎬 Stream Bot — Alle Befehle:**\n\n" +
          "**▶️ Wiedergabe**\n" +
          `\`${p}play <url>\` · \`${p}cam <url>\` — Go-Live / Kamera streamen\n` +
          `\`${p}stop\` — Stream stoppen\n` +
          `\`${p}replay\` (\`${p}r\`) — Letzten Stream wiederholen\n\n` +
          "**🎛️ Einstellungen**\n" +
          `\`${p}volume [0-200]\` (\`${p}vol\`) — Lautstärke (100 = normal)\n` +
          `\`${p}seek <hh:mm:ss>\` — Startposition setzen\n` +
          `\`${p}loop\` — Loop-Modus umschalten\n` +
          `\`${p}quality <preset>\` — Qualität (360p/720p/1080p60/…)\n` +
          `\`${p}quality list\` — Alle Presets anzeigen\n\n` +
          "**📋 Queue**\n" +
          `\`${p}queue add <url> [cam]\` (\`${p}qa\`) — Video zur Queue hinzufügen\n` +
          `\`${p}queue list\` (\`${p}ql\`) — Queue anzeigen\n` +
          `\`${p}queue skip\` (\`${p}qs\`) — Nächstes Video abspielen\n` +
          `\`${p}queue remove <nr>\` — Video aus Queue entfernen\n` +
          `\`${p}queue clear\` (\`${p}qc\`) — Queue leeren\n\n` +
          "**⚽ Liveticker**\n" +
          `\`${p}ticker\` — Liveticker an/aus · \`${p}ticker wm\` — WM 2026 · \`${p}ticker list\` — alle Ligen\n\n` +
          "**ℹ️ Info**\n" +
          `\`${p}np\` — Jetzt läuft (Details)\n` +
          `\`${p}status\` — Kurzübersicht\n` +
          `\`${p}join [id]\` · \`${p}leave\` — Voice-Kanal\n` +
          `\`${p}invite <link>\` — Server über Invite-Link beitreten`
        );
        break;
      }
    }
  } catch (err) {
    console.error("[Fehler]", err);
    message.reply(`❌ Fehler: ${String(err)}`).catch(() => {});
  }
});

// ─── Queue-Handler ────────────────────────────────────────────────────────────

async function handleQueueCommand(args: string[], message: any): Promise<void> {
  const sub = args[0]?.toLowerCase();
  const p = config.prefix;

  switch (sub) {
    case "add": {
      const isCam = args[args.length - 1]?.toLowerCase() === "cam";
      const urlParts = isCam ? args.slice(1, -1) : args.slice(1);
      const url = urlParts.join(" ");
      if (!url) {
        message.reply(`❌ URL fehlt!\nBsp: \`${p}queue add https://...\` oder \`${p}queue add https://... cam\``);
        return;
      }
      const type: "go-live" | "camera" = isCam ? "camera" : "go-live";
      videoQueue.push({ url, type });
      message.reply(
        `✅ Zur Queue hinzugefügt (#${videoQueue.length}): \`${truncate(url, 60)}\`\n` +
        `Modus: **${isCam ? "Kamera" : "Go-Live"}** · Queue: **${videoQueue.length}** Video(s)`
      );
      break;
    }

    case "list": {
      if (videoQueue.length === 0) {
        message.reply(`📋 Queue ist leer.\nHinzufügen: \`${p}queue add <url>\``);
        return;
      }
      const lines = videoQueue.map((item, i) =>
        `**${i + 1}.** [${item.type === "go-live" ? "Live" : "Cam"}] \`${truncate(item.url, 55)}\``
      );
      message.reply(`**📋 Queue (${videoQueue.length} Video(s)):**\n${lines.join("\n")}`);
      break;
    }

    case "skip": {
      if (!isStreaming && videoQueue.length === 0) {
        message.reply("❌ Queue ist leer und kein Stream aktiv!");
        return;
      }
      if (videoQueue.length === 0) {
        await stopCurrentStream();
        message.reply("⏭️ Stream gestoppt (Queue leer).");
        return;
      }
      const next = videoQueue.shift()!;
      await stopCurrentStream();
      message.reply(`⏭️ Nächstes Video: \`${truncate(next.url, 60)}\``);
      startStream(next.url, next.type).catch(err => console.error("[Stream]", err));
      break;
    }

    case "remove": {
      const index = Number(args[1]) - 1;
      if (isNaN(index) || index < 0 || index >= videoQueue.length) {
        message.reply(`❌ Ungültige Nummer! Queue hat **${videoQueue.length}** Video(s).\nBsp: \`${p}queue remove 2\``);
        return;
      }
      const [removed] = videoQueue.splice(index, 1);
      message.reply(`🗑️ Entfernt (#${index + 1}): \`${truncate(removed.url, 60)}\``);
      break;
    }

    case "clear": {
      const count = videoQueue.length;
      videoQueue.length = 0;
      message.reply(count > 0 ? `🗑️ Queue geleert (${count} Video(s) entfernt).` : "📋 Queue war bereits leer.");
      break;
    }

    default: {
      message.reply(
        `**📋 Queue-Befehle:**\n` +
        `\`${p}queue add <url> [cam]\` — Hinzufügen\n` +
        `\`${p}queue list\` — Anzeigen\n` +
        `\`${p}queue skip\` — Nächstes Video\n` +
        `\`${p}queue remove <nr>\` — Entfernen\n` +
        `\`${p}queue clear\` — Leeren`
      );
    }
  }
}

// ─── Quality-Handler ──────────────────────────────────────────────────────────

async function handleQualityCommand(args: string[], message: any): Promise<void> {
  const sub = args[0]?.toLowerCase();
  const p = config.prefix;

  if (!sub || sub === "list") {
    const lines = Object.entries(QUALITY_PRESETS).map(([name, s]) =>
      `\`${name.padEnd(7)}\` — ${String(s.height).padStart(4)}p · ${String(s.fps).padStart(2)} FPS · ${s.bitrateVideo} kbps`
    );
    message.reply(
      "**📋 Qualitäts-Presets:**\n" + lines.join("\n") +
      `\n\n\`${p}quality <preset>\` — setzen · \`${p}quality <preset> restart\` — sofort neu starten`
    );
    return;
  }

  if (sub === "info") {
    const s = currentSettings;
    message.reply(
      `**⚙️ Aktuelle Qualität:**\n` +
      `Auflösung: **${s.height}p** · FPS: **${s.fps}** · Bitrate: **${s.bitrateVideo} kbps** (max ${s.bitrateVideoMax}) · Codec: **${config.videoCodec}**`
    );
    return;
  }

  if (sub === "set") {
    const param = args[1]?.toLowerCase();
    const value = Number(args[2]);
    if (!param || isNaN(value) || value <= 0) {
      message.reply(
        `❌ Bsp: \`${p}quality set fps 60\` · \`${p}quality set res 1440\` · \`${p}quality set bitrate 6000\``
      );
      return;
    }
    switch (param) {
      case "fps":
        if (value < 1 || value > 120) { message.reply("❌ FPS: 1–120"); return; }
        currentSettings.fps = value;
        message.reply(`✅ FPS → **${value}**${activeStreamHint()}`);
        break;
      case "res": case "height":
        if (value < 144 || value > 4320) { message.reply("❌ Auflösung: 144–4320"); return; }
        currentSettings.height = value;
        message.reply(`✅ Auflösung → **${value}p**${activeStreamHint()}`);
        break;
      case "bitrate":
        currentSettings.bitrateVideo = value;
        if (currentSettings.bitrateVideoMax < value) currentSettings.bitrateVideoMax = Math.round(value * 1.5);
        message.reply(`✅ Bitrate → **${value} kbps**${activeStreamHint()}`);
        break;
      case "maxbitrate":
        currentSettings.bitrateVideoMax = value;
        message.reply(`✅ Max-Bitrate → **${value} kbps**${activeStreamHint()}`);
        break;
      default:
        message.reply(`❌ Unbekannt: \`${param}\` · Verfügbar: fps, res, bitrate, maxbitrate`);
    }
    return;
  }

  const preset = QUALITY_PRESETS[sub];
  if (!preset) {
    message.reply(`❌ Unbekanntes Preset: \`${sub}\`\n\`${p}quality list\` für alle Presets.`);
    return;
  }

  const shouldRestart = args[1]?.toLowerCase() === "restart";
  currentSettings = { ...preset };
  const s = currentSettings;

  if (shouldRestart && lastStreamUrl && lastStreamType) {
    await stopCurrentStream();
    message.reply(`✅ Qualität → **${sub}** (${s.height}p · ${s.fps} FPS · ${s.bitrateVideo} kbps)\n🔄 Neustart...`);
    startStream(lastStreamUrl, lastStreamType).catch(err => console.error("[Stream]", err));
  } else {
    message.reply(
      `✅ Qualität → **${sub}** (${s.height}p · ${s.fps} FPS · ${s.bitrateVideo} kbps)\n` +
      (isStreaming ? `💡 \`${p}quality ${sub} restart\` für sofortigen Neustart.` : `💡 Gilt ab dem nächsten Stream.`)
    );
  }
}

// ─── Stream-Logik ─────────────────────────────────────────────────────────────

// ─── Fußball-Liveticker ───────────────────────────────────────────────────────

// Wählbare Liga-Quellen
const TICKER_LEAGUES: Record<string, { label: string; fetch: () => Promise<string | null> }> = {};

// ESPN-API (WM 2026, Champions League, …)
async function fetchEspnScores(slug: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    const live = (data.events ?? []).filter((e: any) => e.status?.type?.state === "in");
    if (live.length === 0) return null;
    return "⚽ " + live.map((e: any) => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
      const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
      if (!home || !away) return e.shortName ?? e.name;
      return `${home.team.abbreviation} ${home.score}:${away.score} ${away.team.abbreviation}`;
    }).join("  |  ");
  } catch {
    return null;
  }
}

// OpenLigaDB (Bundesliga 1+2)
interface OLDBMatch {
  matchDateTimeUTC: string;
  matchIsFinished: boolean;
  team1: { shortName: string };
  team2: { shortName: string };
  matchResults: Array<{ resultTypeID: number; pointsTeam1: number; pointsTeam2: number }>;
}

async function fetchOpenLigaScores(leagues: string[]): Promise<string | null> {
  try {
    const results = await Promise.all(
      leagues.map(l => fetch(`https://api.openligadb.de/getmatchdata/${l}`).then(r => r.json() as Promise<OLDBMatch[]>))
    );
    const now = Date.now();
    const live = results.flat().filter(m => {
      if (m.matchIsFinished) return false;
      const diff = (now - new Date(m.matchDateTimeUTC).getTime()) / 60000;
      return diff >= -2 && diff <= 110;
    });
    if (live.length === 0) return null;
    return "⚽ " + live.map(m => {
      const r = m.matchResults.at(-1);
      const score = r ? `${r.pointsTeam1}:${r.pointsTeam2}` : "vs";
      return `${m.team1.shortName} ${score} ${m.team2.shortName}`;
    }).join("  |  ");
  } catch {
    return null;
  }
}

// Bekannte Ligen
TICKER_LEAGUES["bundesliga"] = { label: "Bundesliga 1+2",        fetch: () => fetchOpenLigaScores(["bl1", "bl2"]) };
TICKER_LEAGUES["bl"]         = TICKER_LEAGUES["bundesliga"];
TICKER_LEAGUES["wm"]         = { label: "WM 2026",               fetch: () => fetchEspnScores("fifa.world") };
TICKER_LEAGUES["wm2026"]     = TICKER_LEAGUES["wm"];
TICKER_LEAGUES["cl"]         = { label: "Champions League",      fetch: () => fetchEspnScores("uefa.champions") };
TICKER_LEAGUES["em"]         = { label: "EM / Euro",             fetch: () => fetchEspnScores("uefa.euro") };
TICKER_LEAGUES["dfb"]        = { label: "DFB-Pokal",             fetch: () => fetchOpenLigaScores(["dfb-pokal"]) };

let tickerLeague = "bundesliga";

async function fetchBundesligaTicker(): Promise<string | null> {
  return TICKER_LEAGUES[tickerLeague]?.fetch() ?? null;
}

async function startFootballTicker(league?: string): Promise<void> {
  if (league && TICKER_LEAGUES[league]) tickerLeague = league;
  stopFootballTicker();
  tickerEnabled = true;
  const update = async () => {
    if (!tickerEnabled) return;
    const ticker = await fetchBundesligaTicker();
    if (ticker) streamer.client.user?.setActivity(ticker, { type: "WATCHING" });
  };
  await update();
  tickerInterval = setInterval(update, 60_000);
  console.log(`[Ticker] Liveticker gestartet — ${TICKER_LEAGUES[tickerLeague]?.label ?? tickerLeague}`);
}

function stopFootballTicker(): void {
  tickerEnabled = false;
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
  try { streamer.client.user?.setActivity(undefined as any); } catch (_) {}
}

// ─── IPTV-Hilfsfunktionen ────────────────────────────────────────────────────

// Liest eine IPTV-M3U-Playlist und extrahiert die erste Stream-URL (z.B. rtsp://).
async function parseM3uStreamUrl(m3uUrl: string): Promise<string | null> {
  try {
    const res = await fetch(m3uUrl);
    if (!res.ok) return null;
    const text = await res.text();
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) return t;
    }
    return null;
  } catch {
    return null;
  }
}

// Parst HLS-Master-Manifest und gibt die URL der Standard-Audio-Rendition zurück.
// Notwendig, weil FFmpeg bei HLS mit separaten Audio-Renditions (EXT-X-MEDIA)
// die Audio-URL als eigenständigen Input braucht — -map 0:a schlägt fehl.
async function fetchHlsAudioUrl(masterUrl: string): Promise<string | null> {
  try {
    const res = await fetch(masterUrl);
    if (!res.ok) return null;
    const text = await res.text();

    let defaultUri: string | null = null;
    let anyUri: string | null = null;

    for (const line of text.split("\n")) {
      if (!line.startsWith("#EXT-X-MEDIA:") || !line.includes("TYPE=AUDIO")) continue;
      const m = line.match(/URI="([^"]+)"/);
      if (!m) continue;
      if (!anyUri) anyUri = m[1];
      if (line.includes("DEFAULT=YES") && !defaultUri) defaultUri = m[1];
    }

    const rel = defaultUri ?? anyUri;
    return rel ? new URL(rel, masterUrl).href : null;
  } catch {
    return null;
  }
}

function getYtDlpBinary(): string {
  const isWin = process.platform === "win32";
  const localBinary = isWin ? "yt-dlp.exe" : "yt-dlp";
  const localPath = join(__dirname, "../", localBinary);
  if (existsSync(localPath)) {
    if (process.platform !== "win32") {
      try {
        execSync(`chmod +x "${localPath}"`);
      } catch (_) {}
    }
    return localPath;
  }
  return "yt-dlp";
}

async function extractStreamUrl(url: string): Promise<string> {
  const isDirect = /\.m3u8(\?|$)/i.test(url) || 
                   /\.mp4(\?|$)/i.test(url) || 
                   /\.mkv(\?|$)/i.test(url) ||
                   url.includes("/hls/");
  
  if (isDirect) {
    return url;
  }

  // IPTV M3U-Playlists direkt parsen — yt-dlp unterstützt kein rtsp://
  const isPlainM3u = /\.m3u(\?|$)/i.test(url) && !isDirect;
  if (isPlainM3u && (url.startsWith("http://") || url.startsWith("https://"))) {
    const extracted = await parseM3uStreamUrl(url);
    if (extracted) {
      console.log(`[M3U] Stream-URL: ${extracted.slice(0, 100)}`);
      return extracted;
    }
  }

  return new Promise((resolve, reject) => {
    console.log(`[yt-dlp] Extrahiere Stream-URL für: ${url}...`);
    const args = ["--js-runtimes", "node", "-f", "b", "-g", url];
    const binary = getYtDlpBinary();
    const child = spawn(binary, args);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        const resolvedUrl = stdout.trim();
        if (resolvedUrl) {
          resolve(resolvedUrl);
        } else {
          reject(new Error("Keine URL von yt-dlp zurückgegeben"));
        }
      } else {
        reject(new Error(`yt-dlp beendet mit Code ${code}: ${stderr.trim()}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

async function startStream(url: string, type: "go-live" | "camera"): Promise<void> {
  lastStreamUrl  = url;
  lastStreamType = type;
  stopRequested  = false;

  const consumedSeek = seekPosition;
  seekPosition = null; // einmalig verbrauchen

  let resolvedUrl = url;
  try {
    resolvedUrl = await extractStreamUrl(url);
  } catch (e) {
    console.warn(`[yt-dlp] Extraktion fehlgeschlagen, verwende Original-URL:`, e instanceof Error ? e.message : e);
  }

  // Fußball-Ticker: Auto-Start wenn URL einem konfigurierten Kanal entspricht
  if (FOOTBALL_STREAM_URLS.some(p => url.includes(p))) {
    startFootballTicker().catch(() => {});
  }

  const encoder = Encoders.software({
    x264: { preset: "superfast" },
    x265: { preset: "superfast" },
  });

  const isHls  = /\.m3u8(\?|$)/i.test(resolvedUrl) || resolvedUrl.includes("/hls/");
  const isHttp = resolvedUrl.startsWith("http://") || resolvedUrl.startsWith("https://");
  const isRtsp = resolvedUrl.startsWith("rtsp://") || resolvedUrl.startsWith("rtsps://");

  let streamInput: string | Readable = resolvedUrl;
  if (isHls) {
    const audioUrl = await fetchHlsAudioUrl(resolvedUrl);
    console.log(`[HLS] Audio-Rendition: ${audioUrl ?? "nicht gefunden, fallback"}`);

    if (audioUrl) {
      const httpOpts = [
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
      ];

      const args = ["-y", "-loglevel", "error", ...httpOpts];
      if (consumedSeek) args.push("-ss", consumedSeek);
      args.push("-i", resolvedUrl);

      args.push(...httpOpts, "-i", audioUrl,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c", "copy", "-f", "mpegts", "-");

      currentPreMux = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
      currentPreMux.on("exit", (code, signal) => {
        if (signal !== "SIGINT" && signal !== "SIGTERM" && code !== 0 && code !== null) {
          console.warn(`[PreMux] FFmpeg beendet: code=${code} signal=${signal}`);
        }
      });
      if (currentPreMux.stdout) {
        streamInput = currentPreMux.stdout;
      } else {
        console.warn("[HLS] Konnte stdout von PreMux nicht abgreifen, verwende Fallback-URL");
        streamInput = resolvedUrl;
      }
    } else {
      streamInput = resolvedUrl;
    }
  }

  const inputOptions: string[] = [];
  if (isRtsp) {
    // RTSP direkt an die Library. RTP-Buffer minimieren (default 5 MB ≈ mehrere Sekunden Lag).
    inputOptions.push(
      "-fflags", "+discardcorrupt",
      "-max_delay", "500000",
      "-rtbufsize", "2M",
      "-analyzeduration", "1000000",
      "-probesize", "2000000",
      "-protocol_whitelist", "file,http,https,tcp,tls,crypto,rtsp,rtp,udp"
    );
  } else if (isHttp && !isHls) {
    inputOptions.push("-protocol_whitelist", "file,http,https,tcp,tls,crypto");
  }
  if (!isHls && consumedSeek) {
    inputOptions.push("-ss", consumedSeek);
  }

  const outputOptions: string[] = [];
  if (config.includeAudio && currentVolume !== 100) {
    outputOptions.push("-af", `volume=${(currentVolume / 100).toFixed(2)}`);
  }

  const { command, output } = prepareStream(streamInput as any, {
    encoder,
    height:             currentSettings.height,
    frameRate:          currentSettings.fps,
    bitrateVideo:       currentSettings.bitrateVideo,
    bitrateVideoMax:    currentSettings.bitrateVideoMax,
    videoCodec:         Utils.normalizeVideoCodec(config.videoCodec),
    includeAudio:       config.includeAudio ?? true,
    customInputOptions: inputOptions,
    customFfmpegFlags:  outputOptions,
  });

  currentCommand = command;
  isStreaming    = true;

  command.on("error", (err: Error) => {
    const msg = err?.message ?? "";
    const isNormal = msg.includes("ffmpeg was killed") || msg.includes("SIGINT") ||
                     msg.includes("SIGKILL") || msg.includes("signal 2") || msg.includes("code 255");
    if (!isNormal) console.error("[FFmpeg]", msg);
  });

  const logLabel = `${type} | ${currentSettings.height}p${currentSettings.fps} | vol:${currentVolume}%` +
    (consumedSeek ? ` | seek:${consumedSeek}` : "");
  console.log(`[Stream] Start — ${logLabel}`);

  playStream(output, streamer, { type })
    .then(() => console.log(`[Stream] Beendet — ${logLabel}`))
    .catch((err: Error) => {
      const msg = err?.message ?? "";
      if (!msg.includes("ffmpeg was killed") && !msg.includes("SIGINT") && !msg.includes("SIGKILL")) {
        console.error("[Stream Fehler]", msg);
      }
    })
    .finally(() => {
      if (currentPreMux) {
        try { currentPreMux.kill("SIGINT"); } catch (_) {}
        currentPreMux = null;
      }
      currentCommand = null;
      isStreaming    = false;
      stopFootballTicker();
      if (!stopRequested) playNextOrLoop();
    });
}

function playNextOrLoop(): void {
  if (videoQueue.length > 0) {
    const next = videoQueue.shift()!;
    console.log(`[Queue] Spiele nächstes: ${truncate(next.url, 80)}`);
    startStream(next.url, next.type).catch(err => console.error("[Stream]", err));
  } else if (loopEnabled && lastStreamUrl && lastStreamType) {
    console.log(`[Loop] Wiederhole: ${truncate(lastStreamUrl, 80)}`);
    startStream(lastStreamUrl, lastStreamType).catch(err => console.error("[Stream]", err));
  }
}

async function stopCurrentStream(): Promise<void> {
  stopRequested = true;
  isStreaming   = false;
  stopFootballTicker();
  if (currentPreMux) {
    try { currentPreMux.kill("SIGINT"); } catch (_) {}
    currentPreMux = null;
  }
  if (currentCommand) {
    try { currentCommand.kill("SIGINT"); } catch (_) {}
    currentCommand = null;
  }
  try { streamer.stopStream(); } catch (_) {}
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function activeStreamHint(): string {
  return isStreaming
    ? `\n💡 \`${config.prefix}replay\` für Neustart mit neuen Einstellungen.`
    : "";
}

function seekInfo(): string {
  return seekPosition ? ` (ab ${formatSeek(seekPosition)})` : "";
}

function formatSeek(pos: string): string {
  const sec = Number(pos);
  if (!isNaN(sec) && !pos.includes(":")) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
  }
  return pos;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}

function extractInviteCode(input: string): string {
  const cleanInput = input.split("?")[0].trim();
  const parts = cleanInput.split("/").filter(p => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : cleanInput;
}

// ─── Login ────────────────────────────────────────────────────────────────────

streamer.client.login(config.token);
