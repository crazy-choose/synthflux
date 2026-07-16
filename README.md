# SynthFlux

OpenAI-compatible media generation MCP server. One URL + one API key, three modalities:

- **Image** — `POST /v1/images/generations` (text-to-image, image-to-image)
- **TTS** — `POST /v1/audio/speech`
- **Video** — async `POST /v1/videos` + poll `GET /agnesapi?video_id=...`

Speak standard OpenAI / Agnes protocol shapes. Point `SYNTHFLUX_BASE_URL` at Agnes directly, StepFun, or your own router backend. Model id is passed through verbatim — your upstream decides what `model` means.

## Install (no Git clone needed)

```bash
npx -y synthflux
```

Then add to your MCP client config (examples below).

## Configure env

```env
SYNTHFLUX_API_KEY=sk-xxx
SYNTHFLUX_BASE_URL=https://apihub.agnes-ai.com
SYNTHFLUX_IMAGE_MODEL=agnes-image-2.1-flash
SYNTHFLUX_TTS_MODEL=step-tts-2
SYNTHFLUX_TTS_VOICE=lively-girl
SYNTHFLUX_VIDEO_MODEL=agnes-video-v2.0
```

All `SYNTHFLUX_*_MODEL` / `SYNTHFLUX_*_VOICE` are defaults; every tool accepts a per-call override.

## Use in Claude Desktop (macOS)

Path: `~/Library/Application Support/Claude/claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "synthflux": {
      "command": "npx",
      "args": ["-y", "synthflux"],
      "env": {
        "SYNTHFLUX_API_KEY": "sk-xxx",
        "SYNTHFLUX_BASE_URL": "https://apihub.agnes-ai.com",
        "SYNTHFLUX_IMAGE_MODEL": "agnes-image-2.1-flash",
        "SYNTHFLUX_TTS_MODEL": "step-tts-2",
        "SYNTHFLUX_TTS_VOICE": "lively-girl",
        "SYNTHFLUX_VIDEO_MODEL": "agnes-video-v2.0"
      }
    }
  }
}
```

## Use in Cursor

Path: `~/.cursor/mcp.json`

```jsonc
{
  "mcpServers": {
    "synthflux": {
      "command": "npx",
      "args": ["-y", "synthflux"],
      "env": {
        "SYNTHFLUX_API_KEY": "sk-xxx",
        "SYNTHFLUX_BASE_URL": "https://api.stepfun.ai",
        "SYNTHFLUX_IMAGE_MODEL": "step-image-edit-2",
        "SYNTHFLUX_TTS_MODEL": "step-tts-2",
        "SYNTHFLUX_TTS_VOICE": "lively-girl"
      }
    }
  }
}
```

## Use in Claude Code

```bash
claude mcp add synthflux -- npx -y synthflux
```

Edit `~/.claude.json` `mcpServers` block for env vars (same env vars as above).

## Use in Codex (openai/codex)

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.synthflux]
command = "npx"
args = ["-y", "synthflux"]

[mcp_servers.synthflux.env]
SYNTHFLUX_API_KEY = "sk-xxx"
SYNTHFLUX_BASE_URL = "https://apihub.agnes-ai.com"
SYNTHFLUX_IMAGE_MODEL = "agnes-image-2.1-flash"
SYNTHFLUX_VIDEO_MODEL = "agnes-video-v2.0"
```

## Switch upstream = change 3 env values

| Upstream | `BASE_URL` | `IMAGE_MODEL` | `TTS_MODEL` | `VIDEO_MODEL` |
|----------|-----------|---------------|------------|---------------|
| Agnes | `https://apihub.agnes-ai.com` | `agnes-image-2.1-flash` | (not supported) | `agnes-video-v2.0` |
| StepFun | `https://api.stepfun.ai` | `step-image-edit-2` | `step-tts-2` or `stepaudio-2.5-tts` | (not supported) |
| Your router backend | `https://api.your-host.com` | (your virtual model id) | (your virtual model id) | (your virtual model id) |

Same MCP code, same protocols, only env rotates.

## Tools

| Tool | Purpose | Default model env |
|------|---------|-------------------|
| `generate_image` | Text-to-image or image-to-image | `SYNTHFLUX_IMAGE_MODEL` |
| `generate_speech` | Text-to-speech, returns audio URL or base64 | `SYNTHFLUX_TTS_MODEL` + `SYNTHFLUX_TTS_VOICE` |
| `create_video_task` | Async video task, returns `video_id` | `SYNTHFLUX_VIDEO_MODEL` |
| `get_video_status` | Poll video task by `video_id` | — |
| `generate_video` | One-shot create + poll | `SYNTHFLUX_VIDEO_MODEL` |

Every tool accepts a per-call override for default params via zod schema.

## Develop

```bash
git clone https://github.com/synthflux-ai/synthflux.git
cd synthflux
npm install
npm run build       # tsc -> dist/
npm run dev        # tsx runner
```

Test server via stdio:

```bash
SYNTHFLUX_API_KEY=dummy SYNTHFLUX_BASE_URL=https://apihub.agnes-ai.com \
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0.0.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' \
  | node dist/index.js
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Roadmap

- [ ] Router backend (Go) — multi-upstream, pricing-aware routing, billing, plan/quota, BYOK
- [ ] Portal (Next.js) — sign-up, billing, API key management
- [ ] More upstream adapters (fal.ai, Replicate, MiniMax, OpenAI)
- [ ] Streaming TTS / image-to-image edits endpoint passthrough
- [ ] Async reverse-proxy mode for video callbacks
