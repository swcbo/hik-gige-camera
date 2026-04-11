/**
 * CLI example: GigE capture with configurable exposure/gain/white-balance.
 * Usage:
 *   node example.js
 *   node example.js --exposure 5000 --gain 2.0
 *   node example.js -e 200000 -g 10 -w continuous -o photo.jpg -v
 */

const path = require('path');
const { HikGigECamera } = require('./src');

const DEFAULTS = {
  exposure: 5000,
  gain: 2.0,
  wb: 'continuous',
  output: './capture.jpg',
};

/**
 * @returns {{ exposure: number, gain: number, wb: string, output: string, ip: string|undefined, verbose: boolean }}
 */
function parseArgs(argv) {
  const out = { ...DEFAULTS, ip: undefined, verbose: false };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value after ${a}`);
      return v;
    };

    if (a === '--exposure' || a === '-e') {
      out.exposure = Number(next());
      if (!Number.isFinite(out.exposure) || out.exposure < 0) {
        throw new Error(`Invalid exposure: ${out.exposure}`);
      }
    } else if (a === '--gain' || a === '-g') {
      out.gain = Number(next());
      if (!Number.isFinite(out.gain)) {
        throw new Error(`Invalid gain: ${out.gain}`);
      }
    } else if (a === '--wb' || a === '-w') {
      out.wb = String(next()).toLowerCase();
      if (!['off', 'once', 'continuous'].includes(out.wb)) {
        throw new Error(`Invalid --wb: use off | once | continuous`);
      }
    } else if (a === '--output' || a === '-o') {
      out.output = path.resolve(String(next()));
    } else if (a === '--ip') {
      out.ip = String(next()).trim() || undefined;
    } else if (a === '--verbose' || a === '-v') {
      out.verbose = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`
Hik GigE capture example

  node example.js [options]

Options:
  -e, --exposure <µs>   Exposure time (default: ${DEFAULTS.exposure})
  -g, --gain <dB>       Gain (default: ${DEFAULTS.gain})
  -w, --wb <mode>       White balance: off | once | continuous (default: ${DEFAULTS.wb})
  -o, --output <path>   Output JPEG path (default: ${DEFAULTS.output})
      --ip <addr>       Camera IPv4 (default: first GigE device)
  -v, --verbose         Print timing logs
  -h, --help            Show this help
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return out;
}

async function main() {
  const opts = parseArgs(process.argv);

  console.log(
    `Parameters: exposure=${opts.exposure}µs gain=${opts.gain}dB wb=${opts.wb} ip=${opts.ip ?? '(auto)'}`
  );

  const camera = new HikGigECamera({
    ip: opts.ip,
    exposure: opts.exposure,
    gain: opts.gain,
    whiteBalance: opts.wb,
    logger: opts.verbose ? console.log : null,
  });

  await camera.connect();
  await camera.captureToFile(opts.output);
  await camera.disconnect();

  const fs = require('fs');
  const stat = fs.statSync(opts.output);
  console.log(`Saved ${opts.output} (${(stat.size / 1024).toFixed(0)}KB)`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
