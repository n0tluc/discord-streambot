# 🎬 Discord Video Stream Selfbot

A powerful Discord selfbot for streaming videos (local files, Twitch streams, YouTube videos/live streams, HLS playlists, ZDF/ARD streams, etc.) directly into voice channels as a Go-Live screen share or a camera feed.

This project is built on top of the [discord-video-stream](https://github.com/Discord-RE/Discord-video-stream) package, is fully compatible with both **Windows** and **Linux**, and utilizes a cross-platform stream piping architecture alongside automated URL extraction via `yt-dlp`.

> [!WARNING]
> Using selfbots (automating user accounts instead of using official bot accounts) is a violation of Discord's Terms of Service. This can lead to a permanent ban of your Discord account. Use this project at your own risk!

---

## ✨ Features

- **📺 Rich Media Sources**: Stream YouTube videos/live streams, Twitch streams, HLS playlists (`.m3u8`), public media streams, local MP4/MKV files, and direct stream URLs.
- **📹 Two Streaming Modes**: Stream as a **Go-Live screen share** or a **Camera feed**.
- **📋 Queue System**: Add multiple streams to a playback queue with auto-play, skip, listing, and clearing capabilities.
- **⏱️ Seek Function**: Start playing videos from a specific time (e.g., `01:30:00` or in seconds).
- **🔂 Loop Mode**: Loop the currently playing stream automatically.
- **🔊 Real-time Volume**: Adjust the playback volume on the fly (from 0% to 200%).
- **🎨 Custom Quality Presets**: Choose quality levels from 360p up to 4K at 60 FPS, or configure custom resolutions, frame rates, and bitrates.
- **🔗 Guild Invite joining**: Join servers directly via chat commands (fully patched against onboarding and captcha-related crashes).

---

## 🛠️ Prerequisites

1. **Node.js**: Version 20 or higher (v26+ recommended).
2. **[FFmpeg](https://ffmpeg.org/)**: Must be installed on your system and added to your environment's `PATH`.
   - *Windows*: Download FFmpeg from the [official download page](https://ffmpeg.org/download.html) and add it to your system variables.
   - *Linux*: Run `sudo apt install ffmpeg`.
3. **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: Used to extract stream links from Twitch/YouTube.
   - *Windows*: Pre-bundled as `yt-dlp.exe` in the root folder.
   - *Linux*: The bot automatically looks for a global installation. Install it via your package manager: `sudo apt install yt-dlp` (or pip/wget).

---

## 🚀 Installation & Getting Started

1. Install Node.js dependencies in the project directory:
   ```bash
   npm install
   ```

2. Configure the bot inside `config.json` (see configuration below).

3. Start the bot:
   - **Development Mode** (with automatic restart on code changes):
     ```bash
     npm run dev
     ```
   - **Production Mode**:
     ```bash
     npm run build
     npm start
     ```

---

## ⚙️ Configuration (`config.json`)

Create or edit `config.json` in the root directory:

```json
{
  "token": "YOUR_DISCORD_USER_TOKEN",
  "prefix": "$",
  "acceptedAuthors": ["YOUR_DISCORD_USER_ID"],
  "height": 1080,
  "fps": 30,
  "bitrateVideo": 5000,
  "bitrateVideoMax": 7500,
  "videoCodec": "H264",
  "includeAudio": true
}
```

---

## 🕹️ Commands

The default prefix is `$`. Only user IDs specified in `acceptedAuthors` can execute commands.

### ▶️ Playback & Voice
| Command | Description | Example |
| :--- | :--- | :--- |
| `$join [channel_id]` | Joins your current voice channel or the voice channel of the specified ID. | `$join 123456789` |
| `$leave` | Leaves the voice channel and stops any active streams. | `$leave` |
| `$play <url>` | Streams the link/media as a Go-Live screen share. | `$play https://youtu.be/dQw4w9WgXcQ` |
| `$cam <url>` | Streams the link/media as a webcam feed. | `$cam https://twitch.tv/honeypuu` |
| `$stop` | Stops the current stream (but stays in the voice channel). | `$stop` |
| `$replay` / `$r` | Restarts the last played stream (useful after modifying settings). | `$r` |

### 🎛️ Settings
| Command | Description | Example |
| :--- | :--- | :--- |
| `$volume [0-200]` | Displays current volume or changes it (100 = default). | `$vol 80` |
| `$seek <time>` | Sets the start offset for the next stream (format `hh:mm:ss`, `mm:ss`, or seconds). Reset using `reset`. | `$seek 01:30:00` |
| `$loop` | Toggles loop mode for the current stream. | `$loop` |
| `$quality <preset>` | Sets the resolution preset for the next stream (e.g. `720p`, `1080p60`, `4k`). | `$quality 1080p60` |
| `$quality list` | Lists all available quality presets. | `$quality list` |
| `$quality set <param> <val>` | Modifies individual options (`fps`, `res`, `bitrate`, `maxbitrate`). | `$quality set fps 60` |

### 📋 Queue
| Command | Description | Example |
| :--- | :--- | :--- |
| `$queue add <url> [cam]` | Adds a video/stream to the queue (append `cam` at the end to play in webcam mode). | `$qa https://... cam` |
| `$queue list` / `$ql` | Displays all videos in the queue. | `$ql` |
| `$queue skip` / `$qs` | Skips the current video and plays the next item in the queue. | `$qs` |
| `$queue remove <nr>` | Removes the item at the specified position from the queue. | `$queue remove 2` |
| `$queue clear` / `$qc` | Clears all items from the queue. | `$qc` |

### ℹ️ Info & Server Management
| Command | Description | Example |
| :--- | :--- | :--- |
| `$np` | Displays detailed info about the currently playing stream. | `$np` |
| `$status` | Displays a brief bot status overview. | `$status` |
| `$invite <link>` | Joins a server using an invite link or code (manual join on Discord client is recommended). | `$invite https://discord.gg/invitecode` |
| `$help` | Displays this help overview. | `$help` |

---

## ❓ Troubleshooting

### 1. `CAPTCHA_SOLVER_NOT_IMPLEMENTED` on `$invite`
When a selfbot joins a guild via the API, Discord often requests a CAPTCHA (especially on cloud hosting IPs).
- **Solution**: Since your selfbot shares your actual personal Discord account, **simply click and join the invite link manually in your official Discord app** once. The bot will automatically be present on the server and ready to stream.

### 2. Linux Execute Permissions for `yt-dlp`
If the bot fails to run `yt-dlp` on Linux:
- **Solution**: The bot automatically attempts to run `chmod +x` on the local `yt-dlp` binary. If it fails, install `yt-dlp` globally via your package manager: `sudo apt install yt-dlp`.

### 3. WebRTC warnings in console
```text
[WebRTC] Ignoriere bekannten Library-Bug: destroyed peer connection
```
This is a harmless, known bug in the Voice Connection handler when a stream starts or stops. The bot catches these warnings automatically and they do not affect operation.

---

## 📜 Credits
This project utilizes the [discord-video-stream](https://github.com/Discord-RE/Discord-video-stream) package for all WebRTC video and audio encoding/packetizing logic.
