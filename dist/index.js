import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import process from "node:process";
// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL = process.env.SYNTHFLUX_BASE_URL ?? "https://apihub.agnes-ai.com";
const API_KEY = process.env.SYNTHFLUX_API_KEY ?? "";
const IMAGE_MODEL = process.env.SYNTHFLUX_IMAGE_MODEL ?? "agnes-image-2.1-flash";
const TTS_MODEL = process.env.SYNTHFLUX_TTS_MODEL ?? "step-tts-2";
const TTS_VOICE = process.env.SYNTHFLUX_TTS_VOICE ?? "lively-girl";
const VIDEO_MODEL = process.env.SYNTHFLUX_VIDEO_MODEL ?? "agnes-video-v2.0";
if (!API_KEY) {
    console.error("[synthflux] SYNTHFLUX_API_KEY env is required.");
    process.exit(1);
}
console.error(`[synthflux] base=${BASE_URL}`);
console.error(`[synthflux] defaults: image=${IMAGE_MODEL} tts=${TTS_MODEL} voice=${TTS_VOICE} video=${VIDEO_MODEL}`);
// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
function authHeaders(extra) {
    return {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(extra ?? {}),
    };
}
async function mediaFetch(path, init = {}) {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    return fetch(url, {
        ...init,
        headers: authHeaders(init.headers),
    });
}
async function jsonOrThrow(resp) {
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`synthflux ${resp.status} ${resp.url}: ${body}`);
    }
    return (await resp.json());
}
// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------
const server = new McpServer({
    name: "synthflux",
    version: "0.1.0",
});
// ===========================================================================
// Tool: generate_image
// POST /v1/images/generations
// Common denominator body:
//   { model, prompt, n?, size?, response_format?, image?: string[], seed? }
// Pass-through extras (Agnes ratio, StepFun steps/cfg_scale/negative_prompt, ...)
// via the optional `extra` object — server just forwards it.
// Response (OpenAI shape): { created?, data: [{ url?, b64_json?, seed?, finish_reason? }] }
// ===========================================================================
server.tool("generate_image", "Generate image via OpenAI-compatible POST /v1/images/generations. Supports text-to-image and image-to-image (pass `image`). Returns image URL or base64.", {
    prompt: z.string().describe("Text prompt for the image."),
    model: z.string().default(IMAGE_MODEL).describe("Model id (upstream-specific). Defaults to SYNTHFLUX_IMAGE_MODEL env."),
    size: z.string().optional().describe("Size in upstream's native format (e.g. '2K', '1024x1024', '1024x768')."),
    n: z.number().int().min(1).max(8).optional().describe("Number of images. OpenAI/StepFun accept; Agnes ignores."),
    response_format: z.enum(["url", "b64_json"]).optional().describe("Output format. 'url' (default) or 'b64_json'."),
    image: z.array(z.string()).optional().describe("Input image URLs or Data URIs for image-to-image (Agnes supports)."),
    seed: z.number().int().optional().describe("Random seed (OpenAI/StepFun support)."),
    extra: z.record(z.string(), z.unknown()).optional().describe("Pass-through extras (e.g. { ratio: '1:1', steps: 8, cfg_scale: 1.0, negative_prompt: '...' })."),
}, async (args) => {
    const body = {
        model: args.model,
        prompt: args.prompt,
    };
    if (args.size !== undefined)
        body.size = args.size;
    if (args.n !== undefined)
        body.n = args.n;
    if (args.response_format !== undefined)
        body.response_format = args.response_format;
    if (args.image !== undefined)
        body.image = args.image;
    if (args.seed !== undefined)
        body.seed = args.seed;
    if (args.extra !== undefined)
        Object.assign(body, args.extra);
    const resp = await mediaFetch("/v1/images/generations", {
        method: "POST",
        body: JSON.stringify(body),
    });
    const data = await jsonOrThrow(resp);
    if (data.error)
        throw new Error(`image error: ${data.error.message}`);
    const item = data.data?.[0];
    if (!item)
        throw new Error("image: empty data response");
    const url = item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : "");
    return {
        content: [{
                type: "text",
                text: JSON.stringify({ image: url, seed: item.seed, finish_reason: item.finish_reason }, null, 2),
            }],
    };
});
// ===========================================================================
// Tool: generate_speech
// POST /v1/audio/speech
// Common denominator body:
//   { model, input, voice, response_format?, speed?, sample_rate? }
// Pass-through extras (StepFun volume/instruction/voice_label/pronunciation_map/return_url,
// OpenAI speech_format, ...) via `extra`.
// Response: audio binary stream OR JSON with url when extra.return_url=true.
// ===========================================================================
server.tool("generate_speech", "Text-to-speech via OpenAI-compatible POST /v1/audio/speech. Returns audio (base64) or URL. Voice & model default from SYNTHFLUX_TTS_VOICE / SYNTHFLUX_TTS_MODEL env.", {
    input: z.string().max(10000).describe("Text to synthesize. StepFun caps at 1000 chars; upstream will reject if exceeded."),
    model: z.string().default(TTS_MODEL).describe("TTS model id (upstream-specific). Defaults to SYNTHFLUX_TTS_MODEL env."),
    voice: z.string().default(TTS_VOICE).describe("Voice id (upstream-specific). Defaults to SYNTHFLUX_TTS_VOICE env."),
    response_format: z.enum(["mp3", "wav", "flac", "opus", "pcm"]).default("mp3").describe("Audio format."),
    speed: z.number().min(0.5).max(2.0).optional().describe("Speed multiplier 0.5-2.0 (StepFun/OpenAI)."),
    sample_rate: z.number().int().optional().describe("Sample rate; StepFun supports 8000/16000/22050/24000/48000."),
    extra: z.record(z.string(), z.unknown()).optional().describe("Pass-through extras (e.g. { volume: 1.0, instruction: '...', voice_label: {...}, pronunciation_map: {...}, return_url: true })."),
}, async (args) => {
    const body = {
        model: args.model,
        input: args.input,
        voice: args.voice,
        response_format: args.response_format,
    };
    if (args.speed !== undefined)
        body.speed = args.speed;
    if (args.sample_rate !== undefined)
        body.sample_rate = args.sample_rate;
    const wantUrl = args.extra?.return_url === true;
    if (args.extra !== undefined)
        Object.assign(body, args.extra);
    const resp = await mediaFetch("/v1/audio/speech", {
        method: "POST",
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`tts ${resp.status} ${resp.url}: ${errBody}`);
    }
    // Two response shapes:
    //   (a) binary audio stream -> base64 it
    //   (b) JSON { url: '...' } when return_url=true (StepFun supports)
    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        const data = await resp.json();
        if (data.error)
            throw new Error(`tts error: ${data.error.message}`);
        if (!data.url)
            throw new Error("tts: json response without url");
        return { content: [{ type: "text", text: JSON.stringify({ audio_url: data.url }, null, 2) }] };
    }
    // binary
    const buf = await resp.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const audio = `data:audio/${args.response_format};base64,${b64}`;
    return {
        content: [{
                type: "text",
                text: JSON.stringify({ audio, format: args.response_format, size_bytes: buf.byteLength, want_url: wantUrl }, null, 2),
            }],
    };
});
// ===========================================================================
// Tool: create_video_task
// POST /v1/videos (Agnes-style async video)
// Body: { model, prompt, image?, width, height, num_frames (8n+1, <=441),
//        frame_rate (1-60), seed?, negative_prompt?, extra_body?: {...} }
// Resp: { video_id, task_id, status, progress, seconds, size, ... }
// ===========================================================================
server.tool("create_video_task", "Create async video task via POST /v1/videos (Agnes-style). Supports text-to-video, image-to-video, keyframes. Returns video_id to poll via get_video_status.", {
    prompt: z.string().describe("Video prompt."),
    model: z.string().default(VIDEO_MODEL).describe("Video model id. Defaults to SYNTHFLUX_VIDEO_MODEL env."),
    image: z.string().optional().describe("Image URL for image-to-video."),
    width: z.number().int().default(1152),
    height: z.number().int().default(768),
    num_frames: z.number().int().max(441).default(121).describe("Frame count. Agnes requires 8n+1 rule (49, 81, 121, 161, 201, 241, ...)."),
    frame_rate: z.number().min(1).max(60).default(24),
    seed: z.number().int().optional(),
    negative_prompt: z.string().optional(),
    extra_body: z.object({
        image: z.array(z.string()).optional(),
        mode: z.string().optional(),
    }).optional().describe("Use mode:'keyframes' + image:[urls] for keyframe animation."),
}, async (args) => {
    const body = {
        model: args.model,
        prompt: args.prompt,
        width: args.width,
        height: args.height,
        num_frames: args.num_frames,
        frame_rate: args.frame_rate,
    };
    if (args.image !== undefined)
        body.image = args.image;
    if (args.seed !== undefined)
        body.seed = args.seed;
    if (args.negative_prompt !== undefined)
        body.negative_prompt = args.negative_prompt;
    if (args.extra_body !== undefined)
        body.extra_body = args.extra_body;
    const resp = await mediaFetch("/v1/videos", {
        method: "POST",
        body: JSON.stringify(body),
    });
    const data = await jsonOrThrow(resp);
    if (data.error)
        throw new Error(`video task error: ${data.error.message}`);
    return {
        content: [{
                type: "text",
                text: JSON.stringify({
                    video_id: data.video_id,
                    task_id: data.task_id,
                    status: data.status,
                    progress: data.progress,
                    estimated_seconds: data.seconds,
                    output_size: data.size,
                    hint: "Poll with get_video_status(video_id=...) until status==completed",
                }, null, 2),
            }],
    };
});
// ===========================================================================
// Tool: get_video_status
// GET /agnesapi?video_id=<VIDEO_ID>[&model_name=<MODEL>]
// Resp: { status, progress, url?, seconds?, size?, error? }
// ===========================================================================
server.tool("get_video_status", "Poll Agnes-style video task by video_id. Returns progress and final url when status=='completed'.", {
    video_id: z.string().describe("video_id returned by create_video_task."),
    model_name: z.string().optional().describe("Override model_name for non-default upstream ids."),
}, async (args) => {
    const params = new URLSearchParams({ video_id: args.video_id });
    if (args.model_name)
        params.set("model_name", args.model_name);
    const resp = await mediaFetch(`/agnesapi?${params}`, { method: "GET" });
    const data = await jsonOrThrow(resp);
    if (data.error)
        throw new Error(`video failed: ${JSON.stringify(data.error)}`);
    return {
        content: [{
                type: "text",
                text: JSON.stringify({
                    status: data.status,
                    progress: data.progress,
                    url: data.status === "completed" ? data.url : undefined,
                    seconds: data.seconds,
                    size: data.size,
                }, null, 2),
            }],
    };
});
// ===========================================================================
// Tool: generate_video (one-shot: create + poll until done)
// Blocking helper. Use with clients that tolerate long tool calls.
// ===========================================================================
server.tool("generate_video", "One-shot helper: create video task, poll until status=='completed' or 'failed', return final url. Blocking; 30-180s typical depending on num_frames.", {
    prompt: z.string(),
    model: z.string().default(VIDEO_MODEL),
    image: z.string().optional(),
    width: z.number().int().default(1152),
    height: z.number().int().default(768),
    num_frames: z.number().int().max(441).default(121),
    frame_rate: z.number().min(1).max(60).default(24),
    poll_interval_ms: z.number().int().min(2000).default(5000),
    max_wait_ms: z.number().int().min(30000).default(300000),
    negative_prompt: z.string().optional(),
    extra_body: z.object({
        image: z.array(z.string()).optional(),
        mode: z.string().optional(),
    }).optional(),
}, async (args) => {
    // 1. create task
    const createBody = {
        model: args.model,
        prompt: args.prompt,
        width: args.width,
        height: args.height,
        num_frames: args.num_frames,
        frame_rate: args.frame_rate,
    };
    if (args.image !== undefined)
        createBody.image = args.image;
    if (args.negative_prompt !== undefined)
        createBody.negative_prompt = args.negative_prompt;
    if (args.extra_body !== undefined)
        createBody.extra_body = args.extra_body;
    const createResp = await mediaFetch("/v1/videos", {
        method: "POST",
        body: JSON.stringify(createBody),
    });
    const task = await jsonOrThrow(createResp);
    if (task.error || !task.video_id) {
        throw new Error(`video create failed: ${task.error?.message ?? "no video_id"}`);
    }
    const videoId = task.video_id;
    // 2. poll
    const deadline = Date.now() + args.max_wait_ms;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, args.poll_interval_ms));
        const params = new URLSearchParams({ video_id: videoId });
        const resp = await mediaFetch(`/agnesapi?${params}`, { method: "GET" });
        const data = await jsonOrThrow(resp);
        if (data.status === "completed") {
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({ url: data.url, video_id: videoId, progress: data.progress }, null, 2),
                    }],
            };
        }
        if (data.status === "failed") {
            throw new Error(`video failed: ${JSON.stringify(data.error)}`);
        }
        // continue polling
    }
    throw new Error(`video timeout; last video_id=${videoId}, poll manually with get_video_status`);
});
// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------
await server.connect(new StdioServerTransport());
console.error("[synthflux] connected");
//# sourceMappingURL=index.js.map