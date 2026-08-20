const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const http = require("http");

const APP_URL = "http://localhost:3000";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const STREAM_KEY = process.env.STREAM_KEY;

if (!STREAM_KEY) {
  console.error("[stream] Missing required environment variable STREAM_KEY. Aborting.");
  process.exit(1);
}

const RTMP_URL = `rtmps://a.rtmps.youtube.com/live2/${STREAM_KEY}`;

let browser = null;
let ffmpeg = null;
let cdpSession = null;
let shuttingDown = false;

function waitForServer(url, retries, delayMs) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const attempt = () => {
      attempts++;
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (attempts >= retries) {
          reject(new Error(`Server at ${url} did not become reachable after ${retries} attempts`));
          return;
        }
        setTimeout(attempt, delayMs);
      });
      req.setTimeout(3000, () => {
        req.destroy();
      });
    };
    attempt();
  });
}

function startFfmpeg() {
  const args = [
    "-loglevel", "warning",
    "-thread_queue_size", "1024",
    "-f", "mjpeg",
    "-framerate", String(FPS),
    "-i", "pipe:0",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-vf", `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-b:v", "4500k",
    "-maxrate", "4500k",
    "-bufsize", "9000k",
    "-g", String(FPS * 2),
    "-keyint_min", String(FPS * 2),
    "-fflags", "+genpts",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-f", "flv",
    RTMP_URL
  ];

  const proc = spawn("ffmpeg", args, { stdio: ["pipe", "inherit", "pipe"] });

  proc.stderr.on("data", (chunk) => {
    process.stdout.write(`[ffmpeg] ${chunk.toString()}`);
  });

  proc.on("error", (err) => {
    console.error("[ffmpeg] Failed to start:", err.message);
    shutdown(1);
  });

  proc.on("exit", (code, signal) => {
    console.error(`[ffmpeg] Exited with code=${code} signal=${signal}`);
    if (!shuttingDown) {
      shutdown(1);
    }
  });

  return proc;
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log("[stream] Shutting down...");

  try {
    if (cdpSession) {
      await cdpSession.send("Page.stopScreencast").catch(() => {});
    }
  } catch (e) {}

  try {
    if (ffmpeg && ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
      ffmpeg.stdin.end();
    }
  } catch (e) {}

  try {
    if (browser) {
      await browser.close();
    }
  } catch (e) {}

  setTimeout(() => {
    process.exit(exitCode || 0);
  }, 1500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  console.log("[stream] Waiting for local game server to be reachable...");
  await waitForServer(APP_URL, 30, 2000);
  console.log("[stream] Server is reachable. Launching headless browser...");

  browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox",
      "--enable-unsafe-swiftshader",
      "--window-size=1080,1920",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-dev-shm-usage"
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  console.log("[stream] Navigating to game...");
  await page.goto(APP_URL, { waitUntil: "load", timeout: 60000 });

  console.log("[stream] Waiting for scene ready signal...");
  await page.waitForFunction("window.__SCENE_READY__ === true", { timeout: 60000 });
  console.log("[stream] Scene is ready.");

  ffmpeg = startFfmpeg();

  cdpSession = await page.target().createCDPSession();

  cdpSession.on("Page.screencastFrame", async (frame) => {
    try {
      const buffer = Buffer.from(frame.data, "base64");
      if (ffmpeg && ffmpeg.stdin && ffmpeg.stdin.writable) {
        ffmpeg.stdin.write(buffer);
      }
      await cdpSession.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    } catch (err) {
      console.error("[stream] Error handling screencast frame:", err.message);
    }
  });

  await cdpSession.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
    everyNthFrame: 1
  });

  console.log("[stream] Screencast started. Streaming live to YouTube...");

  browser.on("disconnected", () => {
    console.error("[stream] Browser disconnected unexpectedly.");
    if (!shuttingDown) shutdown(1);
  });
}

main().catch((err) => {
  console.error("[stream] Fatal error:", err.message);
  shutdown(1);
});
