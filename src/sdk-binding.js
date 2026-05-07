/**
 * koffi FFI bindings for Hikvision MVS MvCameraControl (cross-platform).
 * Struct layouts match CameraParams.h / MvCameraControl.h.
 * @module sdk-binding
 */

const fs = require('fs');
const path = require('path');
const koffi = require('koffi');

/** macOS: prefer SDK bundle so @loader_path deps resolve. */
const SDK_LIB_SEARCH_DARWIN = [
  '/Library/MVS_SDK/lib/libMvCameraControl.dylib',
  '/usr/local/lib/libMvCameraControl.dylib',
];

const SDK_LIB_SEARCH_WIN32 = [
  'C:\\Program Files (x86)\\Common Files\\MVS\\Runtime\\Win64_x64\\MvCameraControl.dll',
  'C:\\Program Files\\MVS\\Runtime\\Win64_x64\\MvCameraControl.dll',
  'C:\\Program Files (x86)\\MVS\\Runtime\\Win64_x64\\MvCameraControl.dll',
];

const SDK_LIB_SEARCH_LINUX = [
  '/opt/MVS/lib/64/libMvCameraControl.so',
  '/usr/lib/libMvCameraControl.so',
  '/usr/local/lib/libMvCameraControl.so',
];

/**
 * @returns {string}
 */
function sdkFileNameForPlatform() {
  switch (process.platform) {
    case 'win32':
      return 'MvCameraControl.dll';
    case 'linux':
      return 'libMvCameraControl.so';
    case 'darwin':
      return 'libMvCameraControl.dylib';
    default:
      throw new Error(`Unsupported platform for MVS SDK: ${process.platform}`);
  }
}

/**
 * Default search list for the current OS.
 * @returns {string[]}
 */
function defaultSearchList() {
  switch (process.platform) {
    case 'win32':
      return SDK_LIB_SEARCH_WIN32;
    case 'linux':
      return SDK_LIB_SEARCH_LINUX;
    case 'darwin':
      return SDK_LIB_SEARCH_DARWIN;
    default:
      return [];
  }
}

/**
 * Ensure @rpath / @loader_path dependencies resolve when loading from a full path (macOS only).
 * @param {string} sdkLibDir Directory containing libMvCameraControl.dylib
 */
function prependDyldLibraryPath(sdkLibDir) {
  if (process.platform !== 'darwin') return;
  if (!sdkLibDir || !fs.existsSync(sdkLibDir)) return;
  const cur = process.env.DYLD_LIBRARY_PATH || '';
  const parts = cur.split(':').filter(Boolean);
  if (!parts.includes(sdkLibDir)) {
    process.env.DYLD_LIBRARY_PATH = [sdkLibDir, ...parts].join(':');
  }
}

/**
 * @returns {string} Absolute path to MvCameraControl shared library
 */
function resolveMvCameraControlPath() {
  const envDir = process.env.MVCAMERA_SDK_PATH;
  if (envDir != null && String(envDir).trim() !== '') {
    const base = path.resolve(String(envDir).trim());
    const joined = path.join(base, sdkFileNameForPlatform());
    try {
      if (fs.existsSync(joined)) return joined;
    } catch {
      /* ignore */
    }
  }

  const list = defaultSearchList();
  for (const p of list) {
    try {
      if (fs.existsSync(p)) return path.resolve(p);
    } catch {
      /* ignore */
    }
  }

  const tried = [envDir ? path.join(String(envDir).trim(), sdkFileNameForPlatform()) : null]
    .filter(Boolean)
    .concat(list);
  throw new Error(
    `MVS SDK library (${sdkFileNameForPlatform()}) not found. Set MVCAMERA_SDK_PATH to the directory containing it, or install MVS runtime. Tried: ${tried.join(', ')}`
  );
}

const libPath = resolveMvCameraControlPath();
prependDyldLibraryPath(path.dirname(libPath));

let lib;
try {
  lib = koffi.load(libPath);
} catch (e) {
  const msg = String(e.message || e);
  if (msg.includes('incompatible architecture')) {
    const nodeArch = process.arch;
    throw new Error(
      `MVS SDK architecture mismatch: Node.js is ${nodeArch} but ${path.basename(libPath)} is a different architecture. ` +
      `Solutions: (1) Install the ${nodeArch} version of Hikvision MVS SDK, or ` +
      `(2) Use a Node.js binary that matches the SDK architecture (e.g. on Apple Silicon with x86_64 SDK: arch -x86_64 node your-script.js)`
    );
  }
  throw e;
}

// --- Structs (CameraParams.h) ---

const MV_GIGE_DEVICE_INFO = koffi.struct('MV_GIGE_DEVICE_INFO', {
  nIpCfgOption: 'uint32',
  nIpCfgCurrent: 'uint32',
  nCurrentIp: 'uint32',
  nCurrentSubNetMask: 'uint32',
  nDefultGateWay: 'uint32',
  chManufacturerName: koffi.array('uint8', 32),
  chModelName: koffi.array('uint8', 32),
  chDeviceVersion: koffi.array('uint8', 32),
  chManufacturerSpecificInfo: koffi.array('uint8', 48),
  chSerialNumber: koffi.array('uint8', 16),
  chUserDefinedName: koffi.array('uint8', 16),
  nNetExport: 'uint32',
  nReserved: koffi.array('uint32', 4),
});

const INFO_MAX_BUFFER_SIZE = 64;

const MV_USB3_DEVICE_INFO = koffi.struct('MV_USB3_DEVICE_INFO', {
  CrtlInEndPoint: 'uint8',
  CrtlOutEndPoint: 'uint8',
  StreamEndPoint: 'uint8',
  EventEndPoint: 'uint8',
  idVendor: 'uint16',
  idProduct: 'uint16',
  nDeviceNumber: 'uint32',
  chDeviceGUID: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chVendorName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chModelName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chFamilyName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chDeviceVersion: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chManufacturerName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chSerialNumber: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chUserDefinedName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  nbcdUSB: 'uint32',
  nDeviceAddress: 'uint32',
  nReserved: koffi.array('uint32', 2),
});

const MV_CamL_DEV_INFO = koffi.struct('MV_CamL_DEV_INFO', {
  chPortID: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chModelName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chFamilyName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chDeviceVersion: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chManufacturerName: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  chSerialNumber: koffi.array('uint8', INFO_MAX_BUFFER_SIZE),
  nReserved: koffi.array('uint32', 38),
});

/** Union SpecialInfo — largest member defines size (MV_USB3_DEVICE_INFO). */
const MV_CC_DEVICE_INFO_SPECIAL = koffi.union('MV_CC_DEVICE_INFO_SPECIAL', {
  stGigEInfo: MV_GIGE_DEVICE_INFO,
  stUsb3VInfo: MV_USB3_DEVICE_INFO,
  stCamLInfo: MV_CamL_DEV_INFO,
});

const MV_CC_DEVICE_INFO = koffi.struct('MV_CC_DEVICE_INFO', {
  nMajorVer: 'uint16',
  nMinorVer: 'uint16',
  nMacAddrHigh: 'uint32',
  nMacAddrLow: 'uint32',
  nTLayerType: 'uint32',
  nReserved: koffi.array('uint32', 4),
  SpecialInfo: MV_CC_DEVICE_INFO_SPECIAL,
});

const MV_CC_DEVICE_INFO_LIST = koffi.struct('MV_CC_DEVICE_INFO_LIST', {
  nDeviceNum: 'uint32',
  /** MV_CC_DEVICE_INFO* pDeviceInfo[256] — SDK fills pointers */
  pDeviceInfo: koffi.array('void*', 256),
});

const MV_FRAME_OUT_UNPARSED = koffi.union('MV_FRAME_OUT_UNPARSED', {
  /** MV_CHUNK_DATA_CONTENT* — stored as opaque pointer (8 bytes) */
  pUnparsedChunkContent: 'void *',
  nAligning: 'int64',
});

/**
 * MvGvspPixelType 在不同平台的 C ABI 不同：
 *   macOS / Linux (Clang)  → int64  (编译器将 enum 提升为 64 位)
 *   Windows (MSVC)         → int32  (enum 始终为 32 位)
 * 类型不匹配会导致后续所有字段偏移错位，nFrameLen 恒读 0。
 */
const PIXEL_TYPE_FFI = process.platform === 'win32' ? 'int32' : 'int64';

const MV_FRAME_OUT_INFO_EX = koffi.struct('MV_FRAME_OUT_INFO_EX', {
  nWidth: 'uint16',
  nHeight: 'uint16',
  enPixelType: PIXEL_TYPE_FFI,
  nFrameNum: 'uint32',
  nDevTimeStampHigh: 'uint32',
  nDevTimeStampLow: 'uint32',
  nReserved0: 'uint32',
  nHostTimeStamp: 'int64',
  nFrameLen: 'uint32',
  nSecondCount: 'uint32',
  nCycleCount: 'uint32',
  nCycleOffset: 'uint32',
  fGain: 'float',
  fExposureTime: 'float',
  nAverageBrightness: 'uint32',
  nRed: 'uint32',
  nGreen: 'uint32',
  nBlue: 'uint32',
  nFrameCounter: 'uint32',
  nTriggerIndex: 'uint32',
  nInput: 'uint32',
  nOutput: 'uint32',
  nOffsetX: 'uint16',
  nOffsetY: 'uint16',
  nChunkWidth: 'uint16',
  nChunkHeight: 'uint16',
  nLostPacket: 'uint32',
  nUnparsedChunkNum: 'uint32',
  UnparsedChunkList: MV_FRAME_OUT_UNPARSED,
  nReserved: koffi.array('uint32', 36),
});

const MV_FRAME_OUT = koffi.struct('MV_FRAME_OUT', {
  pBufAddr: 'void *',
  stFrameInfo: MV_FRAME_OUT_INFO_EX,
  nRes: koffi.array('uint32', 16),
});

const MV_SAVE_IMAGE_PARAM_EX = koffi.struct('MV_SAVE_IMAGE_PARAM_EX', {
  pData: 'void *',
  nDataLen: 'uint32',
  enPixelType: PIXEL_TYPE_FFI,
  nWidth: 'uint16',
  nHeight: 'uint16',
  pImageBuffer: 'void *',
  nImageLen: 'uint32',
  nBufferSize: 'uint32',
  enImageType: 'int32',
  nJpgQuality: 'uint32',
  iMethodValue: 'uint32',
  nReserved: koffi.array('uint32', 3),
});

const MV_MAX_XML_SYMBOLIC_NUM = 64;

const MVCC_ENUMVALUE = koffi.struct('MVCC_ENUMVALUE', {
  nCurValue: 'uint32',
  nSupportedNum: 'uint32',
  nSupportValue: koffi.array('uint32', MV_MAX_XML_SYMBOLIC_NUM),
  nReserved: koffi.array('uint32', 4),
});

const MVCC_FLOATVALUE = koffi.struct('MVCC_FLOATVALUE', {
  fCurValue: 'float',
  fMax: 'float',
  fMin: 'float',
  nReserved: koffi.array('uint32', 4),
});

const MVCC_INTVALUE_EX = koffi.struct('MVCC_INTVALUE_EX', {
  nCurValue: 'int64',
  nMax: 'int64',
  nMin: 'int64',
  nInc: 'int64',
  nReserved: koffi.array('uint32', 16),
});

// --- Functions (MvCameraControl.h) ---

const MV_CC_GetSDKVersion = lib.func('uint32 MV_CC_GetSDKVersion()');

const MV_CC_EnumDevices = lib.func(
  'int32 MV_CC_EnumDevices(uint32 nTLayerType, _Out_ MV_CC_DEVICE_INFO_LIST *pstDevList)'
);

const MV_CC_CreateHandle = lib.func(
  'int32 MV_CC_CreateHandle(_Out_ void **handle, MV_CC_DEVICE_INFO *pstDevInfo)'
);

const MV_CC_DestroyHandle = lib.func('int32 MV_CC_DestroyHandle(void *handle)');

const MV_CC_OpenDevice = lib.func(
  'int32 MV_CC_OpenDevice(void *handle, uint32 nAccessMode, uint16 nSwitchoverKey)'
);

const MV_CC_CloseDevice = lib.func('int32 MV_CC_CloseDevice(void *handle)');

/** C `bool` — 1 byte on Apple Clang */
const MV_CC_IsDeviceConnected = lib.func(
  'uint8 MV_CC_IsDeviceConnected(void *handle)'
);

const MV_CC_SetFloatValue = lib.func(
  'int32 MV_CC_SetFloatValue(void *handle, const char *strKey, float fValue)'
);

const MV_CC_SetEnumValue = lib.func(
  'int32 MV_CC_SetEnumValue(void *handle, const char *strKey, uint32 nValue)'
);

const MV_CC_GetFloatValue = lib.func(
  'int32 MV_CC_GetFloatValue(void *handle, const char *strKey, _Out_ MVCC_FLOATVALUE *pstFloatValue)'
);

const MV_CC_StartGrabbing = lib.func('int32 MV_CC_StartGrabbing(void *handle)');

const MV_CC_StopGrabbing = lib.func('int32 MV_CC_StopGrabbing(void *handle)');

const MV_CC_GetOneFrameTimeout = lib.func(
  'int32 MV_CC_GetOneFrameTimeout(void *handle, uint8 *pData, uint32 nDataSize, _Out_ MV_FRAME_OUT_INFO_EX *pstFrameInfo, uint32 nMsec)'
);

const MV_CC_GetImageBuffer = lib.func(
  'int32 MV_CC_GetImageBuffer(void *handle, _Out_ MV_FRAME_OUT *pstFrame, uint32 nMsec)'
);

const MV_CC_FreeImageBuffer = lib.func(
  'int32 MV_CC_FreeImageBuffer(void *handle, MV_FRAME_OUT *pstFrame)'
);

const MV_CC_SaveImageEx2 = lib.func(
  'int32 MV_CC_SaveImageEx2(void *handle, _Inout_ MV_SAVE_IMAGE_PARAM_EX *pstSaveParam)'
);

const MV_CC_GetOptimalPacketSize = lib.func(
  'int32 MV_CC_GetOptimalPacketSize(void *handle)'
);

const MV_CC_SetIntValueEx = lib.func(
  'int32 MV_CC_SetIntValueEx(void *handle, const char *strKey, int64 nValue)'
);

const MV_GIGE_SetResend = lib.func(
  'int32 MV_GIGE_SetResend(void *handle, uint32 bEnable, uint32 nMaxResendPercent, uint32 nResendTimeout)'
);

module.exports = {
  libPath,
  lib,
  MV_GIGE_DEVICE_INFO,
  MV_USB3_DEVICE_INFO,
  MV_CamL_DEV_INFO,
  MV_CC_DEVICE_INFO_SPECIAL,
  MV_CC_DEVICE_INFO,
  MV_CC_DEVICE_INFO_LIST,
  MV_FRAME_OUT_INFO_EX,
  MV_FRAME_OUT,
  MV_SAVE_IMAGE_PARAM_EX,
  MVCC_ENUMVALUE,
  MVCC_FLOATVALUE,
  MVCC_INTVALUE_EX,
  MV_CC_GetSDKVersion,
  MV_CC_EnumDevices,
  MV_CC_CreateHandle,
  MV_CC_DestroyHandle,
  MV_CC_OpenDevice,
  MV_CC_CloseDevice,
  MV_CC_IsDeviceConnected,
  MV_CC_SetFloatValue,
  MV_CC_SetEnumValue,
  MV_CC_GetFloatValue,
  MV_CC_StartGrabbing,
  MV_CC_StopGrabbing,
  MV_CC_GetOneFrameTimeout,
  MV_CC_GetImageBuffer,
  MV_CC_FreeImageBuffer,
  MV_CC_SaveImageEx2,
  MV_CC_GetOptimalPacketSize,
  MV_CC_SetIntValueEx,
  MV_GIGE_SetResend,
};
