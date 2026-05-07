/**
 * 连接相机 → 每 3s 拍照一次，共 4 次，打印每次拍照耗时
 *
 * Usage:
 *   node scripts/test-capture.js [--ip 192.168.1.100]
 *   # Apple Silicon + x86_64 SDK:
 *   ./run.sh scripts/test-capture.js
 */

const { HikGigECamera } = require("../src/index");
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");

const TOTAL_SHOTS = 4;
const INTERVAL_MS = 3000;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ip" && args[i + 1]) opts.ip = args[++i];
    if (args[i] === "--exposure" && args[i + 1])
      opts.exposure = Number(args[++i]);
    if (args[i] === "--gain" && args[i + 1]) opts.gain = Number(args[++i]);
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const opts = parseArgs();

  const camera = new HikGigECamera({
    ip: opts.ip,
    exposure: opts.exposure ?? 200000,
    gain: opts.gain ?? 10.0,
    whiteBalance: "continuous",
    jpegQuality: 95,
    logger: (msg) => console.log(msg),
  });

  const imagesDir = path.join(__dirname, "..", "images");
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  console.log("\n===== 连接相机 =====");
  const t0 = performance.now();
  await camera.connect();
  console.log(`连接耗时: ${(performance.now() - t0).toFixed(0)}ms\n`);

  const results = [];

  for (let i = 1; i <= TOTAL_SHOTS; i++) {
    if (i > 1) {
      console.log(`等待 ${INTERVAL_MS / 1000}s ...`);
      await sleep(INTERVAL_MS);
    }

    console.log(`----- 第 ${i}/${TOTAL_SHOTS} 次拍照 -----`);
    const tShot = performance.now();
    const buf = await camera.captureBuffer();
    const elapsed = performance.now() - tShot;
    const sizeKB = (buf.length / 1024).toFixed(1);

    const filePath = path.join(imagesDir, `capture_${i}.jpg`);
    fs.writeFileSync(filePath, buf);

    console.log(`  耗时: ${elapsed.toFixed(1)}ms | 大小: ${sizeKB}KB | 保存: ${filePath}`);
    results.push({ shot: i, ms: elapsed, sizeKB: Number(sizeKB) });
  }

  console.log("\n===== 断开相机 =====");
  await camera.disconnect();

  console.log("\n===== 汇总 =====");
  console.table(results);
  const avg = results.reduce((s, r) => s + r.ms, 0) / results.length;
  console.log(`平均拍照耗时: ${avg.toFixed(1)}ms\n`);
}

main().catch((err) => {
  console.error("测试失败:", err.message);
  process.exit(1);
});
