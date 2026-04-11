# hik-gige-camera

Node.js driver for **Hikvision GigE industrial cameras** via MVS SDK, using [koffi](https://koffi.dev/) FFI binding. No Python subprocess, no native C++ addon compilation — just pure JavaScript calling the official Hikvision dynamic library directly.

[中文文档](#中文文档)

---

## Features

- **Single-frame capture** → JPEG Buffer / Base64 / File
- **Parameter control** — exposure, gain, white balance
- **Cross-platform** — Windows, Linux, macOS
- **High performance** — pre-allocated buffers, persistent GigE stream, ~200-400ms per capture for 20MP sensors
- **TypeScript** — full `.d.ts` type declarations included
- **Zero native compilation** — koffi handles FFI, no `node-gyp` needed

## Prerequisites

### 1. Hikvision MVS SDK (Required)

This package calls the official Hikvision MVS SDK dynamic library via FFI. You **must** install the SDK on the target machine.

Download from: [Hikvision Machine Vision Download Center](https://www.hikrobotics.com/en/machinevision/service/download)

| Platform | SDK Library | Default Search Path |
|----------|-------------|---------------------|
| Windows  | `MvCameraControl.dll` | `C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64\` |
| Linux    | `libMvCameraControl.so` | `/opt/MVS/lib/64/` |
| macOS    | `libMvCameraControl.dylib` | `/Library/MVS_SDK/lib/` |

If the SDK is installed to a non-default location, set the environment variable:

```bash
export MVCAMERA_SDK_PATH=/your/custom/sdk/lib/path
```

### 2. Node.js >= 18

```bash
node -v  # Must be >= 18.0.0
```

### 3. GigE Camera Network

- Camera and host must be on the **same subnet** (e.g. `169.254.x.x`)
- Use a **dedicated Ethernet port** for the camera (not through a switch shared with other traffic)
- Recommended: set the NIC's MTU to **9000** (jumbo frames) for best performance

## Installation

```bash
npm install hik-gige-camera
```

## Quick Start

```javascript
const { HikGigECamera } = require('hik-gige-camera');

async function main() {
  const camera = new HikGigECamera({
    ip: '169.254.100.70',       // optional, auto-detect if omitted
    exposure: 5000,              // µs (default: 5000)
    gain: 2.0,                   // dB (default: 2.0)
    whiteBalance: 'continuous',  // 'off' | 'once' | 'continuous' (default: 'continuous')
    logger: console.log,         // optional, null = silent
  });

  await camera.connect();                    // connect + apply params + start grabbing
  const buffer = await camera.captureBuffer();  // JPEG Buffer
  await camera.captureToFile('./photo.jpg');    // save to file
  await camera.disconnect();                    // stop grabbing + close device
}

main().catch(console.error);
```

## API Reference

### `new HikGigECamera(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ip` | `string` | `undefined` | Camera IPv4. Omit to use the first detected GigE device. |
| `exposure` | `number` | `5000` | Exposure time in microseconds (µs). |
| `gain` | `number` | `2.0` | Analog gain in dB. |
| `whiteBalance` | `string` | `'continuous'` | `'off'`, `'once'`, or `'continuous'`. |
| `logger` | `function \| null` | `null` | Pass `console.log` to enable timing logs. |
| `jpegQuality` | `number` | `90` | JPEG compression quality (1–100). |

### Methods

#### `camera.connect(): Promise<void>`

Enumerates GigE devices, connects to the target camera, applies all parameters (exposure, gain, white balance), pre-allocates frame buffers (~96MB), and starts the GigE stream.

#### `camera.disconnect(): Promise<void>`

Stops grabbing, closes the device, destroys the handle, and releases buffers. Safe to call multiple times.

#### `camera.setExposure(us: number): Promise<void>`

Set exposure time in microseconds. Can be called while connected.

#### `camera.setGain(value: number): Promise<void>`

Set analog gain in dB. Can be called while connected.

#### `camera.setWhiteBalance(mode: 'off' | 'once' | 'continuous'): Promise<void>`

Set auto white balance mode. Can be called while connected.

#### `camera.captureBuffer(): Promise<Buffer>`

Grab one frame and return it as a JPEG `Buffer`. The GigE stream stays active between calls — subsequent captures are faster (~200ms) since there's no stream setup overhead.

#### `camera.captureBase64(): Promise<string>`

Same as `captureBuffer()`, but returns a Base64-encoded string.

#### `camera.captureToFile(filePath: string): Promise<void>`

Same as `captureBuffer()`, but writes the JPEG to the specified file path.

### Exported Constants

```javascript
const { constants } = require('hik-gige-camera');

console.log(constants.MV_OK);                         // 0x00000000
console.log(constants.MV_GIGE_DEVICE);                // 0x00000001
console.log(constants.MV_BALANCEWHITE_AUTO_CONTINUOUS); // 2
```

## Logging Output

When `logger` is set (e.g. `console.log`), you get detailed per-step timing:

```
[HikCamera] connect: EnumDevices ... 1010ms
[HikCamera] connect: CreateHandle ... 86ms
[HikCamera] connect: OpenDevice ... 508ms
[HikCamera] connect: ConfigureGigE ... 15ms
[HikCamera] connect: SetAutoOff ... 8ms
[HikCamera] setExposure ... 6ms
[HikCamera] setGain ... 6ms
[HikCamera] setWhiteBalance ... 7ms
[HikCamera] connect: StartGrabbing ... 78ms
[HikCamera] connect: total 1732ms
[HikCamera] captureBuffer: GetOneFrame ... 228ms
[HikCamera] captureBuffer: SaveImageJPEG ... 164ms
[HikCamera] captureBuffer: total 393ms (5472x3648 BayerGB8 → JPEG 388.0KB)
```

## Performance

Tested with MV-CS200-10GC (5472×3648, 20MP, BayerGB8):

| Operation | Time | Notes |
|-----------|------|-------|
| `connect()` | ~1.7s | One-time cost (GigE handshake) |
| `captureBuffer()` (first) | ~400ms | Includes exposure wait |
| `captureBuffer()` (subsequent) | ~230ms | Frame already in buffer |
| Burst 3 frames | ~970ms total | GetOneFrame drops to 1-2ms |

## Architecture Compatibility

**Key rule: Node.js architecture must match the MVS SDK architecture.**

| Environment | Node.js | MVS SDK | Status |
|-------------|---------|---------|--------|
| Windows x64 | x64 | x64 | Works directly |
| Linux x64 | x64 | x64 | Works directly |
| macOS Intel | x64 | x64 | Works directly |
| macOS Apple Silicon | arm64 | arm64 | Works — install ARM64 SDK |
| macOS Apple Silicon | x64 (Rosetta) | x64 | Works — see below |

### macOS Apple Silicon with x86_64 SDK

If your MVS SDK is x86_64 only, you need to run Node.js under Rosetta:

```bash
# Install x64 Node.js locally
curl -sL "https://nodejs.org/dist/v22.22.0/node-v22.22.0-darwin-x64.tar.gz" -o /tmp/node-x64.tar.gz
mkdir -p .node-x64
tar xf /tmp/node-x64.tar.gz -C .node-x64 --strip-components=1

# Reinstall native dependencies for x64
rm -rf node_modules
arch -x86_64 .node-x64/bin/node .node-x64/bin/npm install

# Run your script
arch -x86_64 .node-x64/bin/node your-script.js
```

## Troubleshooting

### `MVS SDK library not found`

The SDK is not installed or not in the expected location. Solutions:

1. Install the Hikvision MVS SDK for your platform
2. Set `MVCAMERA_SDK_PATH` to the directory containing the SDK library:
   ```bash
   # Linux
   export MVCAMERA_SDK_PATH=/opt/MVS/lib/64
   # Windows (PowerShell)
   $env:MVCAMERA_SDK_PATH = "C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64"
   ```

### `MVS SDK architecture mismatch`

Node.js and the SDK are compiled for different CPU architectures. See the [Architecture Compatibility](#architecture-compatibility) section.

### `No GigE devices found`

1. Check that the camera is powered on and the GigE cable is connected
2. Verify your host NIC has an IP in the same subnet as the camera (e.g. `169.254.x.x`)
3. Make sure no other application (e.g. MVS Client) is exclusively holding the device
4. On Linux, you may need to run with elevated permissions or configure the network interface

### `MV_CC_OpenDevice failed: 0x80000203 (ACCESS_DENIED)`

Another process has the camera open in exclusive mode. Close MVS Client or any other application using the camera.

### Slow first capture

The first `captureBuffer()` call after `connect()` may be slower because the camera needs time to fill its internal buffer. Subsequent calls are faster as the GigE stream is already active.

## CLI Example

The repository includes an `example.js` for quick testing:

```bash
# Default parameters (exposure=5000µs, gain=2.0dB)
node example.js

# Custom parameters
node example.js --exposure 10000 --gain 5.0 --wb once --output photo.jpg

# With verbose timing logs
node example.js -e 5000 -g 2.0 -v

# Specify camera IP
node example.js --ip 169.254.100.70 -v

# Help
node example.js --help
```

## License

MIT

---

<a id="中文文档"></a>

# 中文文档

## hik-gige-camera

基于 Node.js 的**海康威视 GigE 工业相机**驱动，通过 [koffi](https://koffi.dev/) FFI 直接调用海康官方 MVS SDK 动态库。无需 Python 子进程，无需编译原生 C++ 插件。

## 功能特性

- **单帧拍照** → JPEG Buffer / Base64 / 文件
- **参数控制** — 曝光、增益、白平衡
- **跨平台** — Windows、Linux、macOS
- **高性能** — 预分配 Buffer、持久化 GigE 流，20MP 传感器单帧拍照 ~200-400ms
- **TypeScript** — 包含完整 `.d.ts` 类型声明
- **零编译** — koffi 处理 FFI，无需 `node-gyp`

## 前置条件

### 1. 海康 MVS SDK（必需）

本包通过 FFI 调用海康官方 MVS SDK 动态库，**必须**在目标机器上安装 SDK。

下载地址：[海康机器人机器视觉下载中心](https://www.hikrobotics.com/cn/machinevision/service/download)

| 平台 | SDK 库文件 | 默认搜索路径 |
|------|-----------|-------------|
| Windows | `MvCameraControl.dll` | `C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64\` |
| Linux | `libMvCameraControl.so` | `/opt/MVS/lib/64/` |
| macOS | `libMvCameraControl.dylib` | `/Library/MVS_SDK/lib/` |

SDK 安装在非默认位置时，设置环境变量：

```bash
export MVCAMERA_SDK_PATH=/your/custom/sdk/lib/path
```

### 2. Node.js >= 18

```bash
node -v  # 必须 >= 18.0.0
```

### 3. GigE 相机网络配置

- 相机和主机必须在**同一子网**（如 `169.254.x.x`）
- 建议使用**专用网口**连接相机（不要与其他流量共享交换机）
- 建议设置网卡 MTU 为 **9000**（巨帧）以获得最佳传输性能

## 安装

```bash
npm install hik-gige-camera
```

## 快速开始

```javascript
const { HikGigECamera } = require('hik-gige-camera');

async function main() {
  const camera = new HikGigECamera({
    ip: '169.254.100.70',       // 可选，不传则自动检测第一个 GigE 设备
    exposure: 5000,              // 曝光时间 µs（默认 5000）
    gain: 2.0,                   // 增益 dB（默认 2.0）
    whiteBalance: 'continuous',  // 白平衡 'off' | 'once' | 'continuous'（默认 'continuous'）
    logger: console.log,         // 可选，传入即开启日志
  });

  await camera.connect();                       // 连接 + 设参数 + 开始取流
  const buffer = await camera.captureBuffer();  // 获取 JPEG Buffer
  await camera.captureToFile('./photo.jpg');     // 保存到文件
  await camera.disconnect();                    // 停止取流 + 关闭设备
}

main().catch(console.error);
```

## API 参考

### `new HikGigECamera(options?)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `ip` | `string` | `undefined` | 相机 IPv4 地址，不传则自动检测第一个 GigE 设备 |
| `exposure` | `number` | `5000` | 曝光时间（微秒 µs） |
| `gain` | `number` | `2.0` | 模拟增益（dB） |
| `whiteBalance` | `string` | `'continuous'` | `'off'`、`'once'` 或 `'continuous'` |
| `logger` | `function \| null` | `null` | 传 `console.log` 开启计时日志 |
| `jpegQuality` | `number` | `90` | JPEG 压缩质量（1–100） |

### 方法

#### `camera.connect(): Promise<void>`

枚举 GigE 设备，连接目标相机，应用所有参数（曝光、增益、白平衡），预分配帧缓冲区（~96MB），并启动 GigE 取流。

#### `camera.disconnect(): Promise<void>`

停止取流，关闭设备，销毁句柄，释放缓冲区。可安全多次调用。

#### `camera.setExposure(us: number): Promise<void>`

设置曝光时间（微秒），连接后可随时调用。

#### `camera.setGain(value: number): Promise<void>`

设置模拟增益（dB），连接后可随时调用。

#### `camera.setWhiteBalance(mode): Promise<void>`

设置白平衡模式：`'off'`（关闭）、`'once'`（单次）、`'continuous'`（持续自动）。

#### `camera.captureBuffer(): Promise<Buffer>`

抓取一帧并返回 JPEG `Buffer`。GigE 流在两次调用之间保持活跃——后续拍照更快（~200ms），无需重建流。

#### `camera.captureBase64(): Promise<string>`

同 `captureBuffer()`，但返回 Base64 编码字符串。

#### `camera.captureToFile(filePath: string): Promise<void>`

同 `captureBuffer()`，但将 JPEG 写入指定文件路径。

## 日志输出

设置 `logger` 后（如 `console.log`），可看到详细的分步耗时：

```
[HikCamera] connect: EnumDevices ... 1010ms
[HikCamera] connect: CreateHandle ... 86ms
[HikCamera] connect: OpenDevice ... 508ms
[HikCamera] connect: ConfigureGigE ... 15ms
[HikCamera] connect: SetAutoOff ... 8ms
[HikCamera] setExposure ... 6ms
[HikCamera] setGain ... 6ms
[HikCamera] setWhiteBalance ... 7ms
[HikCamera] connect: StartGrabbing ... 78ms
[HikCamera] connect: total 1732ms
[HikCamera] captureBuffer: GetOneFrame ... 228ms
[HikCamera] captureBuffer: SaveImageJPEG ... 164ms
[HikCamera] captureBuffer: total 393ms (5472x3648 BayerGB8 → JPEG 388.0KB)
```

## 性能数据

测试相机：MV-CS200-10GC（5472×3648，2000万像素，BayerGB8）

| 操作 | 耗时 | 说明 |
|------|------|------|
| `connect()` | ~1.7s | 一次性开销（GigE 协议握手） |
| `captureBuffer()`（首次） | ~400ms | 包含曝光等待时间 |
| `captureBuffer()`（后续） | ~230ms | 帧已在缓冲区中 |
| 连拍 3 帧 | 总计 ~970ms | GetOneFrame 降至 1-2ms |

## 架构兼容性

**核心规则：Node.js 架构必须与 MVS SDK 架构一致。**

| 环境 | Node.js | MVS SDK | 状态 |
|------|---------|---------|------|
| Windows x64 | x64 | x64 | 直接使用 |
| Linux x64 | x64 | x64 | 直接使用 |
| macOS Intel | x64 | x64 | 直接使用 |
| macOS Apple Silicon | arm64 | arm64 | 安装 ARM64 版 SDK |
| macOS Apple Silicon | x64 (Rosetta) | x64 | 可用 — 见下文 |

### macOS Apple Silicon + x86_64 SDK

如果你的 MVS SDK 仅有 x86_64 版本，需要通过 Rosetta 运行 x86_64 的 Node.js：

```bash
# 下载 x64 版 Node.js
curl -sL "https://nodejs.org/dist/v22.22.0/node-v22.22.0-darwin-x64.tar.gz" -o /tmp/node-x64.tar.gz
mkdir -p .node-x64
tar xf /tmp/node-x64.tar.gz -C .node-x64 --strip-components=1

# 重装 native 依赖（匹配 x64 架构）
rm -rf node_modules
arch -x86_64 .node-x64/bin/node .node-x64/bin/npm install

# 运行脚本
arch -x86_64 .node-x64/bin/node your-script.js
```

## 常见问题

### `MVS SDK library not found`（找不到 SDK 库）

SDK 未安装或不在预期路径。解决方法：

1. 安装对应平台的海康 MVS SDK
2. 设置 `MVCAMERA_SDK_PATH` 环境变量指向 SDK 库所在目录：
   ```bash
   # Linux
   export MVCAMERA_SDK_PATH=/opt/MVS/lib/64
   # Windows (PowerShell)
   $env:MVCAMERA_SDK_PATH = "C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64"
   ```

### `MVS SDK architecture mismatch`（架构不匹配）

Node.js 和 SDK 编译的 CPU 架构不同。参见 [架构兼容性](#架构兼容性) 章节。

### `No GigE devices found`（未发现 GigE 设备）

1. 检查相机是否通电、GigE 网线是否连接
2. 确认主机网卡 IP 与相机在同一子网（如 `169.254.x.x`）
3. 确保没有其他程序（如 MVS Client）以独占模式占用相机
4. Linux 下可能需要 root 权限或配置网络接口

### `MV_CC_OpenDevice failed: 0x80000203`（拒绝访问）

其他进程以独占模式打开了相机。关闭 MVS Client 或其他正在使用相机的程序。

### 首次拍照较慢

`connect()` 后第一次 `captureBuffer()` 可能稍慢，因为相机需要时间填充内部缓冲区。后续调用更快，GigE 取流持续活跃。

## CLI 示例

仓库包含 `example.js` 用于快速测试：

```bash
# 默认参数（曝光 5000µs，增益 2.0dB）
node example.js

# 自定义参数
node example.js --exposure 10000 --gain 5.0 --wb once --output photo.jpg

# 带详细日志
node example.js -e 5000 -g 2.0 -v

# 指定相机 IP
node example.js --ip 169.254.100.70 -v

# 帮助
node example.js --help
```

## 许可证

MIT
