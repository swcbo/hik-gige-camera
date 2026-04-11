/**
 * SDK connectivity test — verifies dylib loading, device enumeration, and IP detection.
 * Run: npm run test:sdk
 */

const sdk = require('../src/sdk-binding');
const C = require('../src/constants');
const koffi = require('koffi');

function ipFromUint32(n) {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

function bytesToString(arr) {
  const end = arr.indexOf(0);
  return Buffer.from(arr.slice(0, end === -1 ? arr.length : end)).toString('utf8');
}

console.log('=== Hikvision MVS SDK Test ===\n');

const ver = sdk.MV_CC_GetSDKVersion();
const major = (ver >> 24) & 0xff;
const minor = (ver >> 16) & 0xff;
const rev = (ver >> 8) & 0xff;
const build = ver & 0xff;
console.log(`SDK Version: V${major}.${minor}.${rev}.${build} (0x${ver.toString(16).padStart(8, '0')})`);
console.log(`SDK lib: ${sdk.libPath}\n`);

const devList = {};
const ret = sdk.MV_CC_EnumDevices(C.MV_GIGE_DEVICE | C.MV_USB_DEVICE, devList);
if (ret !== C.MV_OK) {
  console.error(`EnumDevices failed: 0x${(ret >>> 0).toString(16)}`);
  process.exit(1);
}

const n = devList.nDeviceNum | 0;
console.log(`Found ${n} device(s)\n`);

if (n === 0) {
  console.log('No devices found. Check that:');
  console.log('  1. Camera is powered on and connected via GigE cable');
  console.log('  2. Your network interface has an IP in the same subnet (e.g. 169.254.x.x)');
  console.log('  3. No other application (MVS Client) is exclusively holding the device');
  process.exit(0);
}

for (let i = 0; i < n; i++) {
  const ptr = devList.pDeviceInfo[i];
  if (!ptr) continue;

  const tLayer = koffi.decode(ptr, 12, 'uint32');
  console.log(`--- Device #${i} ---`);
  console.log(`  Transport: ${tLayer === C.MV_GIGE_DEVICE ? 'GigE' : tLayer === C.MV_USB_DEVICE ? 'USB3' : `0x${tLayer.toString(16)}`}`);

  if (tLayer === C.MV_GIGE_DEVICE) {
    const ip = koffi.decode(ptr, 40, 'uint32') >>> 0;
    const mask = koffi.decode(ptr, 44, 'uint32') >>> 0;
    const gw = koffi.decode(ptr, 48, 'uint32') >>> 0;
    console.log(`  IP: ${ipFromUint32(ip)}`);
    console.log(`  Subnet: ${ipFromUint32(mask)}`);
    console.log(`  Gateway: ${ipFromUint32(gw)}`);
  }
}

console.log('\n=== Test Complete ===');
