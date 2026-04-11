export interface HikCameraOptions {
  /** Camera IP address (default: auto-detect first GigE device) */
  ip?: string;
  /** Exposure time in microseconds (default: 200000) */
  exposure?: number;
  /** Gain in dB (default: 10.0) */
  gain?: number;
  /** White balance mode: 'off' | 'once' | 'continuous' (default: 'continuous') */
  whiteBalance?: 'off' | 'once' | 'continuous';
  /** Logger function for timing info (default: null = silent) */
  logger?: ((msg: string) => void) | null;
  /** JPEG quality 1-100 (default: 90) */
  jpegQuality?: number;
}

export class HikGigECamera {
  constructor(options?: HikCameraOptions);
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setExposure(us: number): Promise<void>;
  setGain(value: number): Promise<void>;
  setWhiteBalance(mode: 'off' | 'once' | 'continuous'): Promise<void>;
  captureBuffer(): Promise<Buffer>;
  captureBase64(): Promise<string>;
  captureToFile(filePath: string): Promise<void>;
}

export declare const constants: {
  MV_OK: number;
  MV_GIGE_DEVICE: number;
  MV_USB_DEVICE: number;
  MV_Image_Jpeg: number;
  MV_Image_Bmp: number;
  MV_EXPOSURE_AUTO_MODE_OFF: number;
  MV_GAIN_MODE_OFF: number;
  MV_BALANCEWHITE_AUTO_OFF: number;
  MV_BALANCEWHITE_AUTO_ONCE: number;
  MV_BALANCEWHITE_AUTO_CONTINUOUS: number;
  [key: string]: number | string;
};
