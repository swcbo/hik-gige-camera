/**
 * Hikvision GigE camera wrapper (MVS SDK via koffi).
 * @module camera
 */

const { performance } = require("node:perf_hooks");
const koffi = require("koffi");
const fs = require("fs").promises;
const sdk = require("./sdk-binding");
const C = require("./constants");

/** Raw frame buffer (~64MB) for max sensor sizes (e.g. 5472×3648×3). */
const FRAME_BUF_BYTES = 64 * 1024 * 1024;

/** JPEG output buffer upper bound. */
const JPEG_BUF_BYTES = 32 * 1024 * 1024;

/** @type {Map<number, string>} Common GVSP pixel types for logs */
const PIXEL_LABELS = new Map([
  [0x01080001, "Mono8"],
  [0x01080008, "BayerGR8"],
  [0x01080009, "BayerRG8"],
  [0x0108000a, "BayerGB8"],
  [0x0108000b, "BayerBG8"],
  [0x02180014, "RGB8"],
  [0x02180015, "BGR8"],
]);

/**
 * @param {number} px
 * @returns {string}
 */
function pixelTypeLabel(px) {
  const n = Number(px) >>> 0;
  return PIXEL_LABELS.get(n) ?? `Pixel0x${n.toString(16)}`;
}

/**
 * @param {number} n
 * @returns {string}
 */
function formatBytes(n) {
  const b = n >>> 0;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${b}B`;
}

/**
 * @param {string} mode
 * @returns {number}
 */
function whiteBalanceModeToEnum(mode) {
  const m = String(mode).trim().toLowerCase();
  if (m === "off") return C.MV_BALANCEWHITE_AUTO_OFF;
  if (m === "once") return C.MV_BALANCEWHITE_AUTO_ONCE;
  if (m === "continuous") return C.MV_BALANCEWHITE_AUTO_CONTINUOUS;
  throw new Error(
    `Invalid whiteBalance mode: ${mode} (expected 'off', 'once', or 'continuous')`,
  );
}

/**
 * @param {number} ret SDK return code (signed int32)
 * @param {string} operation Description for Error.message
 * @throws {Error} When ret !== MV_OK
 */
function assertMvOk(ret, operation) {
  const code = ret | 0;
  if (code === (C.MV_OK | 0)) return;
  const hex = (code >>> 0).toString(16).toUpperCase().padStart(8, "0");
  const err = new Error(`MVS SDK error in ${operation}: 0x${hex} (${code})`);
  err.code = code >>> 0;
  throw err;
}

/**
 * Dotted IPv4 string to uint32 (same wire order as MV_GIGE_DEVICE_INFO.nCurrentIp).
 * @param {string} ip
 * @returns {number}
 */
function ipToUint32(ip) {
  const parts = String(ip).trim().split(".");
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 string: ${ip}`);
  }
  const o = parts.map((x) => {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`Invalid IPv4 octet: ${x}`);
    }
    return n;
  });
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

/**
 * @typedef {Object} HikGigECameraOptions
 * @property {string} [ip] Camera IPv4; omit to use the first GigE device.
 * @property {number} [exposure=200000] Exposure time (µs).
 * @property {number} [gain=10.0] Analog gain (dB).
 * @property {'off'|'once'|'continuous'} [whiteBalance='continuous'] Auto white balance mode.
 * @property {(msg: string) => void} [logger] Log sink; default silent.
 * @property {number} [jpegQuality=90] JPEG quality 1–100.
 */

/**
 * GigE industrial camera using Hikvision MVS C API.
 */
class HikGigECamera {
  /**
   * @param {HikGigECameraOptions} [options={}]
   */
  constructor(options = {}) {
    const q = Number(options.jpegQuality ?? 90);
    /** @type {Required<Pick<HikGigECameraOptions, 'exposure'|'gain'|'whiteBalance'|'jpegQuality'>> & { ip?: string }} */
    this._options = {
      ip: options.ip,
      exposure: options.exposure ?? 200000,
      gain: options.gain ?? 10.0,
      whiteBalance: options.whiteBalance ?? "continuous",
      jpegQuality: Number.isFinite(q)
        ? Math.min(100, Math.max(1, Math.round(q)))
        : 90,
    };
    /** @type {((msg: string) => void) | null} */
    this._logger = typeof options.logger === "function" ? options.logger : null;

    /** @type {unknown} */
    this._handle = null;
    /** @type {boolean} */
    this._grabbing = false;
    /** @type {Buffer | null} */
    this._rawBuf = null;
    /** @type {Buffer | null} */
    this._jpegBuf = null;

    /** @type {Map<string, number>} */
    this._timeMarks = new Map();
  }

  /**
   * @param {string} msg
   */
  _log(msg) {
    if (this._logger) this._logger(msg);
  }

  /**
   * @param {string} label
   */
  _time(label) {
    this._timeMarks.set(label, performance.now());
  }

  /**
   * @param {string} label
   * @returns {number} Elapsed ms
   */
  _timeEnd(label) {
    const t0 = this._timeMarks.get(label);
    this._timeMarks.delete(label);
    if (t0 == null) return 0;
    return performance.now() - t0;
  }

  _requireHandle() {
    if (!this._handle) {
      throw new Error("Not connected; call connect() first");
    }
  }

  /**
   * Enumerate GigE devices, optionally select by IP, open and configure stream.
   * Applies `exposure`, `gain`, `whiteBalance`, and `jpegQuality` from constructor options.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._handle) {
      throw new Error("Already connected");
    }

    const ip = this._options.ip;
    const tConnect0 = performance.now();

    this._time("connect:EnumDevices");
    const devList = {};
    assertMvOk(
      sdk.MV_CC_EnumDevices(C.MV_GIGE_DEVICE, devList),
      "MV_CC_EnumDevices",
    );
    this._log(
      `[HikCamera] connect: EnumDevices ... ${this._timeEnd("connect:EnumDevices").toFixed(0)}ms`,
    );

    const n = devList.nDeviceNum | 0;
    if (n <= 0) {
      throw new Error(
        "No GigE devices found (MV_CC_EnumDevices returned 0 devices)",
      );
    }

    const wantIp =
      ip != null && String(ip).trim() !== "" ? ipToUint32(ip) : null;

    /** @type {unknown} */
    let chosen = null;
    for (let i = 0; i < n; i++) {
      const p = devList.pDeviceInfo[i];
      if (p == null) continue;

      /** nTLayerType offset 12 (see CameraParams.h MV_CC_DEVICE_INFO) */
      const tLayer = koffi.decode(p, 12, "uint32") | 0;
      if (tLayer !== C.MV_GIGE_DEVICE) continue;

      if (wantIp == null) {
        chosen = p;
        break;
      }
      /** MV_GIGE_DEVICE_INFO.nCurrentIp at offset 8 within SpecialInfo (offset 32) → 40 */
      const curIp = koffi.decode(p, 40, "uint32") >>> 0;
      if (curIp === wantIp) {
        chosen = p;
        break;
      }
    }

    if (chosen == null) {
      throw new Error(
        wantIp != null
          ? `No GigE device with IP ${ip} (expected 0x${wantIp.toString(16)})`
          : "No suitable GigE device in list",
      );
    }

    this._time("connect:CreateHandle");
    const handleOut = [null];
    assertMvOk(sdk.MV_CC_CreateHandle(handleOut, chosen), "MV_CC_CreateHandle");
    this._handle = handleOut[0];
    this._log(
      `[HikCamera] connect: CreateHandle ... ${this._timeEnd("connect:CreateHandle").toFixed(0)}ms`,
    );

    this._time("connect:OpenDevice");
    assertMvOk(
      sdk.MV_CC_OpenDevice(this._handle, C.MV_ACCESS_Exclusive, 0),
      "MV_CC_OpenDevice",
    );
    this._log(
      `[HikCamera] connect: OpenDevice ... ${this._timeEnd("connect:OpenDevice").toFixed(0)}ms`,
    );

    this._time("connect:ConfigureGigE");
    const pkt = sdk.MV_CC_GetOptimalPacketSize(this._handle) | 0;
    if (pkt > 0) {
      assertMvOk(
        sdk.MV_CC_SetIntValueEx(
          this._handle,
          C.FEATURE_GEV_PACKET_SIZE,
          BigInt(pkt),
        ),
        "MV_CC_SetIntValueEx(GevSCPSPacketSize)",
      );
    }

    assertMvOk(
      sdk.MV_GIGE_SetResend(this._handle, 1, 20, 300),
      "MV_GIGE_SetResend",
    );
    this._log(
      `[HikCamera] connect: ConfigureGigE ... ${this._timeEnd("connect:ConfigureGigE").toFixed(0)}ms`,
    );

    this._time("connect:SetAutoOff");
    assertMvOk(
      sdk.MV_CC_SetEnumValue(
        this._handle,
        C.FEATURE_EXPOSURE_AUTO,
        C.MV_EXPOSURE_AUTO_MODE_OFF,
      ),
      "MV_CC_SetEnumValue(ExposureAuto)",
    );
    assertMvOk(
      sdk.MV_CC_SetEnumValue(
        this._handle,
        C.FEATURE_GAIN_AUTO,
        C.MV_GAIN_MODE_OFF,
      ),
      "MV_CC_SetEnumValue(GainAuto)",
    );
    this._log(
      `[HikCamera] connect: SetAutoOff ... ${this._timeEnd("connect:SetAutoOff").toFixed(0)}ms`,
    );

    await this.setExposure(this._options.exposure);
    await this.setGain(this._options.gain);
    await this.setWhiteBalance(this._options.whiteBalance);

    this._rawBuf = Buffer.allocUnsafe(FRAME_BUF_BYTES);
    this._jpegBuf = Buffer.allocUnsafe(JPEG_BUF_BYTES);

    this._time("connect:StartGrabbing");
    assertMvOk(sdk.MV_CC_StartGrabbing(this._handle), "MV_CC_StartGrabbing");
    this._grabbing = true;
    this._log(
      `[HikCamera] connect: StartGrabbing ... ${this._timeEnd("connect:StartGrabbing").toFixed(0)}ms`,
    );

    this._log(
      `[HikCamera] connect: total ${(performance.now() - tConnect0).toFixed(0)}ms`,
    );
  }

  /**
   * Stop grabbing, close device, destroy handle.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this._handle) return;
    try {
      if (this._grabbing) {
        try {
          sdk.MV_CC_StopGrabbing(this._handle);
        } catch {
          /* ignore */
        }
        this._grabbing = false;
      }
      try {
        sdk.MV_CC_CloseDevice(this._handle);
      } catch {
        /* ignore */
      }
    } finally {
      try {
        sdk.MV_CC_DestroyHandle(this._handle);
      } catch {
        /* ignore */
      }
      this._handle = null;
      this._rawBuf = null;
      this._jpegBuf = null;
    }
  }

  /**
   * Set exposure time in microseconds (GenICam ExposureTime float node).
   * @param {number} us
   * @returns {Promise<void>}
   */
  async setExposure(us) {
    this._requireHandle();
    this._time("setExposure");
    assertMvOk(
      sdk.MV_CC_SetFloatValue(this._handle, "ExposureTime", us),
      "MV_CC_SetFloatValue(ExposureTime)",
    );
    this._log(
      `[HikCamera] setExposure ... ${this._timeEnd("setExposure").toFixed(0)}ms`,
    );
  }

  /**
   * Set analog gain (GenICam Gain float node).
   * @param {number} value
   * @returns {Promise<void>}
   */
  async setGain(value) {
    this._requireHandle();
    this._time("setGain");
    assertMvOk(
      sdk.MV_CC_SetFloatValue(this._handle, "Gain", value),
      "MV_CC_SetFloatValue(Gain)",
    );
    this._log(
      `[HikCamera] setGain ... ${this._timeEnd("setGain").toFixed(0)}ms`,
    );
  }

  /**
   * Set auto white balance mode (GenICam BalanceWhiteAuto).
   * @param {'off'|'once'|'continuous'} mode
   * @returns {Promise<void>}
   */
  async setWhiteBalance(mode) {
    this._requireHandle();
    this._time("setWhiteBalance");
    const v = whiteBalanceModeToEnum(mode);
    assertMvOk(
      sdk.MV_CC_SetEnumValue(this._handle, C.FEATURE_BALANCE_WHITE_AUTO, v),
      "MV_CC_SetEnumValue(BalanceWhiteAuto)",
    );
    this._log(
      `[HikCamera] setWhiteBalance ... ${this._timeEnd("setWhiteBalance").toFixed(0)}ms`,
    );
  }

  /**
   * Grab one frame, encode JPEG via MV_CC_SaveImageEx2, return JPEG bytes.
   * @returns {Promise<Buffer>}
   */
  async captureBuffer() {
    this._requireHandle();
    if (!this._grabbing || !this._rawBuf || !this._jpegBuf) {
      throw new Error(
        "Grabbing not active; connect() failed or buffers missing",
      );
    }

    const raw = this._rawBuf;
    const jpegBuf = this._jpegBuf;
    const frameInfo = {};
    const tCap0 = performance.now();

    this._time("captureBuffer:GetOneFrame");
    assertMvOk(
      sdk.MV_CC_GetOneFrameTimeout(
        this._handle,
        raw,
        raw.length,
        frameInfo,
        5000,
      ),
      "MV_CC_GetOneFrameTimeout",
    );
    this._log(
      `[HikCamera] captureBuffer: GetOneFrame ... ${this._timeEnd("captureBuffer:GetOneFrame").toFixed(0)}ms`,
    );

    const w = frameInfo.nWidth | 0;
    const h = frameInfo.nHeight | 0;
    let nFrameLen = frameInfo.nFrameLen >>> 0;
    const px = Number(frameInfo.enPixelType);

    if (nFrameLen > raw.length) {
      throw new Error(
        `Frame length ${nFrameLen} exceeds raw buffer (${raw.length})`,
      );
    }
    if (nFrameLen === 0) {
      throw new Error(
        "MV_CC_GetOneFrameTimeout returned nFrameLen 0 (invalid frame metadata)",
      );
    }

    const jpegCap = jpegBuf.length;
    const saveParam = {
      pData: raw,
      nDataLen: nFrameLen,
      enPixelType: px,
      nWidth: w,
      nHeight: h,
      pImageBuffer: jpegBuf,
      nImageLen: 0,
      nBufferSize: jpegCap,
      enImageType: C.MV_Image_Jpeg,
      nJpgQuality: this._options.jpegQuality,
      iMethodValue: 0,
    };

    this._time("captureBuffer:SaveImageJPEG");
    assertMvOk(
      sdk.MV_CC_SaveImageEx2(this._handle, saveParam),
      "MV_CC_SaveImageEx2",
    );
    this._log(
      `[HikCamera] captureBuffer: SaveImageJPEG ... ${this._timeEnd("captureBuffer:SaveImageJPEG").toFixed(0)}ms`,
    );

    const outLen = saveParam.nImageLen >>> 0;
    if (outLen === 0 || outLen > jpegBuf.length) {
      throw new Error(
        `MV_CC_SaveImageEx2 produced invalid nImageLen=${outLen}`,
      );
    }

    const pxLabel = pixelTypeLabel(px);
    const totalMs = performance.now() - tCap0;
    this._log(
      `[HikCamera] captureBuffer: total ${totalMs.toFixed(0)}ms (${w}x${h} ${pxLabel} → JPEG ${formatBytes(outLen)})`,
    );

    return jpegBuf.subarray(0, outLen);
  }

  /**
   * @returns {Promise<string>} Base64-encoded JPEG
   */
  async captureBase64() {
    const buf = await this.captureBuffer();
    return buf.toString("base64");
  }

  /**
   * @param {string} filePath Output path (JPEG)
   * @returns {Promise<void>}
   */
  async captureToFile(filePath) {
    const buf = await this.captureBuffer();
    await fs.writeFile(filePath, buf);
  }
}

module.exports = { HikGigECamera, assertMvOk, ipToUint32 };
