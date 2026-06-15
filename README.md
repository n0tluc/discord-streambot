# 🎬 Discord Video Stream Selfbot

Ein leistungsstarker Discord-Selfbot zum Streamen von Videos (Dateien, Twitch, YouTube, HLS-Playlists, ZDF/ARD-Mediathek etc.) direkt in Voice-Kanäle (Go-Live-Übertragungen oder Kamera-Feed). 

> [!WARNING]
> **WICHTIGER HINWEIS (Discord ToS)**: Die Verwendung von Selfbots (automatisierte Interaktionen über einen normalen Benutzer-Account statt eines offiziellen Bot-Accounts) verstößt gegen die Nutzungsbedingungen (Terms of Service) von Discord. Dies kann dazu führen, dass dein Discord-Account permanent gesperrt wird. Die Nutzung dieses Projekts erfolgt auf eigene Gefahr!

Dieses Projekt ist voll kompatibel mit **Windows** und **Linux** und nutzt eine plattformunabhängige Stream-Piping-Architektur sowie eine automatische Auflösung über `yt-dlp`.

---

## ✨ Features

- **📺 Vielfältige Quellen**: Streamt YouTube-Videos/Live-Streams, Twitch-Streams, HLS-Playlists (`.m3u8`), ZDF/ARD-Streams, lokale MP4/MKV-Dateien und Direct-URLs.
- **📹 Zwei Streaming-Modi**: Streamen als **Go-Live-Übertragung** (Bildschirmübertragung) oder als **Kamera-Feed**.
- **📋 Queue-System**: Hinzufügen von Streams in eine Wiedergabeliste mit Auto-Play, Skip, Liste und Clear.
- **⏱️ Seek-Funktion**: Starte Videos/Streams ab einer bestimmten Zeitmarke (z. B. `01:30:00` oder in Sekunden).
- **🔂 Loop-Modus**: Automatische Wiederholung des aktuellen Streams.
- **🔊 Lautstärkeregelung**: Passe die Lautstärke in Echtzeit an (von 0 % bis 200 %).
- **🎨 Qualitäts-Presets & Anpassung**: Vordefinierte Presets von 360p bis 4K / 60 FPS sowie freie Bitraten- und FPS-Wahl.
- **🔗 Invite-Joining**: Beitritt zu Discord-Servern direkt per Chat-Command (inklusive Schutz vor Onboarding- und Captcha-Abstürzen).

---

## 🛠️ Voraussetzungen

1. **Node.js**: Version 20 oder höher (v26+ empfohlen).
2. **FFmpeg**: Muss auf deinem System installiert und in den Systemvariablen (`PATH`) eingetragen sein.
   - *Windows*: FFmpeg herunterladen und PATH setzen.
   - *Linux*: `sudo apt install ffmpeg` ausführen.
3. **yt-dlp**: Wird für das Extrahieren von Twitch/YouTube-Streams verwendet.
   - *Windows*: Liegt als ausführbare `yt-dlp.exe` im Projektordner.
   - *Linux*: Der Bot sucht standardmäßig nach einem installierten `yt-dlp`. Installiere es einfach über deinen Paketmanager: `sudo apt install yt-dlp` (oder über pip/wget).

---

## 🚀 Installation & Start

1. Installiere die Node-Abhängigkeiten im Projektordner:
   ```bash
   npm install
   ```

2. Passe die Konfiguration in der `config.json` an (siehe unten).

3. Starte den Bot:
   - **Entwicklungsmodus** (mit Auto-Reload bei Änderungen):
     ```bash
     npm run dev
     ```
   - **Produktionsmodus**:
     ```bash
     npm run build
     npm start
     ```

---

## ⚙️ Konfiguration (`config.json`)

Erstelle oder bearbeite die `config.json` im Hauptverzeichnis des Projekts:

```json
{
  "token": "DEIN_DISCORD_USER_TOKEN",
  "prefix": "$",
  "acceptedAuthors": ["DEINE_DISCORD_USER_ID"],
  "height": 1080,
  "fps": 30,
  "bitrateVideo": 5000,
  "bitrateVideoMax": 7500,
  "videoCodec": "H264",
  "includeAudio": true
}
```

> ⚠️ **Achtung**: Selfbots (Bots, die auf normalen Benutzer-Accounts laufen) verstoßen gegen die Nutzungsbedingungen von Discord. Die Verwendung erfolgt auf eigene Gefahr!

---

## 🕹️ Befehle

Standardmäßig wird das Präfix `$` verwendet. Nur in der `acceptedAuthors`-Liste eingetragene User-IDs können Befehle ausführen.

### ▶️ Wiedergabe & Voice
| Befehl | Beschreibung | Beispiel |
| :--- | :--- | :--- |
| `$join [channel_id]` | Tritt deinem aktuellen Voice-Kanal oder der angegebenen ID bei. | `$join 123456789` |
| `$leave` | Verlässt den Voice-Kanal und stoppt alle Streams. | `$leave` |
| `$play <url>` | Startet eine Go-Live Bildschirmübertragung des Links/Streams. | `$play https://youtu.be/dQw4w9WgXcQ` |
| `$cam <url>` | Startet den Stream als Kamera-Feed im Voice-Kanal. | `$cam https://twitch.tv/honeypuu` |
| `$stop` | Stoppt den aktuellen Stream (aber bleibt im Voice-Kanal). | `$stop` |
| `$replay` / `$r` | Startet den zuletzt gespielten Stream neu (hilfreich nach Einstellungsänderungen). | `$r` |

### 🎛️ Einstellungen
| Befehl | Beschreibung | Beispiel |
| :--- | :--- | :--- |
| `$volume [0-200]` | Zeigt die aktuelle Lautstärke an oder ändert sie (100 = normal). | `$vol 80` |
| `$seek <zeit>` | Setzt die Startposition für den nächsten Stream (Format `hh:mm:ss`, `mm:ss` oder Sekunden). Zurücksetzen mit `reset`. | `$seek 01:30:00` |
| `$loop` | Schaltet die automatische Wiederholung des aktuellen Videos ein/aus. | `$loop` |
| `$quality <preset>` | Ändert die Qualität für den nächsten Stream (z. B. `720p`, `1080p60`, `4k`). | `$quality 1080p60` |
| `$quality list` | Listet alle verfügbaren Qualitäts-Presets auf. | `$quality list` |
| `$quality set <param> <wert>` | Ändert einzelne Parameter (`fps`, `res`, `bitrate`, `maxbitrate`). | `$quality set fps 60` |

### 📋 Queue (Wiedergabeliste)
| Befehl | Beschreibung | Beispiel |
| :--- | :--- | :--- |
| `$queue add <url> [cam]` | Fügt einen Stream zur Queue hinzu (optional mit `cam` am Ende für Kamera-Modus). | `$qa https://... cam` |
| `$queue list` / `$ql` | Zeigt alle anstehenden Streams in der Queue an. | `$ql` |
| `$queue skip` / `$qs` | Stoppt den aktuellen Stream und spielt das nächste Video aus der Queue ab. | `$qs` |
| `$queue remove <nr>` | Entfernt das Video an der angegebenen Position aus der Queue. | `$queue remove 2` |
| `$queue clear` / `$qc` | Leert die gesamte Queue. | `$qc` |

### ℹ️ Info & Verwaltung
| Befehl | Beschreibung | Beispiel |
| :--- | :--- | :--- |
| `$np` | Zeigt detaillierte Infos zum aktuell laufenden Stream an. | `$np` |
| `$status` | Zeigt eine kurze Statusübersicht an. | `$status` |
| `$invite <link>` | Lässt den Account dem angegebenen Server beitreten (Alternative: Tritt im echten Client bei). | `$invite https://discord.gg/invitecode` |
| `$help` | Zeigt die Hilfeübersicht an. | `$help` |

---

## ❓ Problembehandlung (Troubleshooting)

### 1. `CAPTCHA_SOLVER_NOT_IMPLEMENTED` beim Invite-Command
Wenn du einen Server per `$invite` beitreten möchtest, verlangt Discord oft ein CAPTCHA (besonders auf Linux-Servern).
- **Lösung**: Da der Selfbot auf demselben Account wie dein normaler Discord-Client läuft, musst du dem Server lediglich **einmal manuell in deinem normalen Discord-Client beitreten** und das CAPTCHA dort lösen. Der Bot ist danach automatisch auf dem Server präsent.

### 2. Fehlende Berechtigungen auf Linux bei `yt-dlp`
Wenn die lokale `yt-dlp` Datei auf Linux nicht ausgeführt werden kann:
- **Lösung**: Der Bot versucht automatisch `chmod +x` auf dem lokalen Binärpfad auszuführen. Sollte dies fehlschlagen, installiere `yt-dlp` einfach global: `sudo apt install yt-dlp`.

### 3. WebRTC Warnung im Log
```text
[WebRTC] Ignoriere bekannten Library-Bug: destroyed peer connection
```
Dies ist ein bekannter, harmloser Bug in der Sprachverbindungsbibliothek von Discord, wenn ein Stream beendet oder neu gestartet wird. Diese Fehlermeldungen werden vom Bot automatisch abgefangen und beeinträchtigen den Betrieb nicht.
