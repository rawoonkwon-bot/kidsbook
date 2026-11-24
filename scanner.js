// 고속 바코드 스캐너
// 영어책 인식이 느린 주된 원인과 대응:
//  - 바코드 옆 EAN-5 가격 바코드, 여러 포맷 동시 탐색 → 포맷을 EAN-13 하나로 제한
//  - 바코드가 작아 가까이 대면 초점이 안 맞음 → 고해상도 + 연속 초점 + 기본 확대(줌)
//  - 매 프레임 전체 화면 해석 → 가이드 네모 영역만 잘라서 해석
//  - 프레임이 밀려 쌓임 → 한 번에 하나만 해석, 끝나면 최신 프레임으로
import { toIsbn13 } from "./isbn.js";

const FORMATS = ["ean_13"];
const MAX_CROP_W = 1280;
const BARCODE_LIB = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.4/ponyfill/+esm";
let detectorPromise = null;

function loadPonyfill() {
  // 엔진 JS와 WASM은 jsDelivr CDN에서 받음 (WASM 파일도 CDN 기본 경로)
  return import(BARCODE_LIB).then((m) => {
    m.prepareZXingModule({ fireImmediately: true });
    return { detector: new m.BarcodeDetector({ formats: FORMATS }), engine: "zxing-wasm", native: false };
  });
}

/** 페이지 로드 직후 호출해 엔진을 미리 준비(첫 스캔 지연 제거) */
export function warmUpDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    try {
      if ("BarcodeDetector" in window) {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported.includes("ean_13")) {
          return { detector: new window.BarcodeDetector({ formats: FORMATS }), engine: "네이티브", native: true };
        }
      }
    } catch { /* 네이티브 미지원 → WASM */ }
    return loadPonyfill();
  })();
  return detectorPromise;
}

export class Scanner {
  constructor({ video, roiEl, onDetect, onStatus }) {
    this.video = video;
    this.roiEl = roiEl;
    this.onDetect = onDetect;
    this.onStatus = onStatus || (() => {});
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.running = false;
    this.busy = false;
    this.stream = null;
    this.track = null;
    this.frames = 0;
  }

  async start() {
    const { detector, engine, native } = await warmUpDetector();
    this.detector = detector;
    this.native = native;
    this.engine = engine;

    // 앱을 연 동안에는 카메라를 다시 켜지 않고 그대로 씀 → 아이폰에서 스캔할 때마다 허락을 묻지 않음
    clearTimeout(this.idleTimer);
    if (this.stream && this.track?.readyState === "live" && !this.track.muted) {
      this.track.enabled = true;
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      this.running = true;
      this.startedAt = performance.now();
      this.frames = 0;
      this.lastCode = null;
      this.loop();
      return;
    }
    this.release();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});

    this.caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
    const adv = {};
    if (this.caps.focusMode?.includes("continuous")) adv.focusMode = "continuous";
    // 작은 바코드를 멀리서도 또렷하게: 기본 1.6배 확대 (최소 초점거리 문제 회피)
    if (this.caps.zoom) adv.zoom = Math.min(this.caps.zoom.max, Math.max(this.caps.zoom.min, 1.6));
    if (Object.keys(adv).length) {
      try { await this.track.applyConstraints({ advanced: [adv] }); } catch { /* 무시 */ }
    }

    this.running = true;
    this.startedAt = performance.now();
    this.frames = 0;
    this.lastCode = null;
    this.loop();
  }

  setZoom(z) {
    if (!this.caps?.zoom) return;
    this.track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {});
  }

  async setTorch(on) {
    if (!this.caps?.torch) return false;
    try { await this.track.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch { return false; }
  }

  // 스캔 화면을 닫을 때: 카메라는 잠시 꺼 두기만 하고(허락 유지), 1분 동안 안 쓰면 완전히 끔
  stop() {
    this.running = false;
    if (this.track) {
      if (this.caps?.torch) this.track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      this.track.enabled = false;
    }
    this.video.pause();
    this.video.srcObject = null;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.release(), 60 * 1000);
  }

  release() {
    clearTimeout(this.idleTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
  }

  /** 화면의 가이드 네모가 실제 영상의 어느 영역인지 계산 (object-fit: cover 보정) */
  cropRect() {
    const v = this.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    const vr = v.getBoundingClientRect();
    const rr = this.roiEl.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const ox = (vr.width - vw * scale) / 2;
    const oy = (vr.height - vh * scale) / 2;
    // 손떨림 대비 상하좌우 여유 15%
    const padX = rr.width * 0.15, padY = rr.height * 0.15;
    let x = (rr.left - vr.left - padX - ox) / scale;
    let y = (rr.top - vr.top - padY - oy) / scale;
    let w = (rr.width + padX * 2) / scale;
    let h = (rr.height + padY * 2) / scale;
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    return { x, y, w, h };
  }

  loop() {
    if (!this.running) return;
    const next = () => {
      if (!this.running) return;
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(() => this.tick());
      else requestAnimationFrame(() => this.tick());
    };
    this._next = next;
    next();
  }

  async tick() {
    if (!this.running) return;
    if (this.busy || this.video.readyState < 2 || !this.video.videoWidth) return this._next();
    this.busy = true;
    try {
      const { x, y, w, h } = this.cropRect();
      const s = Math.min(1, MAX_CROP_W / w);
      const cw = Math.round(w * s), ch = Math.round(h * s);
      if (this.canvas.width !== cw) this.canvas.width = cw;
      if (this.canvas.height !== ch) this.canvas.height = ch;
      this.ctx.drawImage(this.video, x, y, w, h, 0, 0, cw, ch);
      const src = this.native ? this.canvas : this.ctx.getImageData(0, 0, cw, ch);
      const results = await this.detector.detect(src);
      this.frames++;
      for (const r of results) {
        const isbn = toIsbn13(r.rawValue);
        if (isbn) {
          this.running = false;
          this.onDetect({ isbn, raw: r.rawValue, ms: performance.now() - this.startedAt, frames: this.frames, engine: this.engine });
          return;
        }
        if (r.rawValue) this.onStatus("책 바코드(978/979로 시작)를 비춰 주세요");
      }
    } catch (e) {
      console.warn(e);
    } finally {
      this.busy = false;
    }
    this._next();
  }
}
