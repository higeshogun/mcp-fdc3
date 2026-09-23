/**
 * Voice Activity Detection (VAD) & Audio Level Processor
 * 
 * Provides continuous microphone streaming, dynamic energy calculation,
 * speech start/end detection with rolling pre-buffer, and audio level telemetry for visualizers.
 */

export interface VadCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: (audioBlob: Blob) => void;
  onAudioLevel: (level: number) => void; // 0.0 to 1.0
  onError?: (err: Error) => void;
}

export interface VadConfig {
  silenceTimeoutMs?: number; // Time of continuous silence before ending turn (default: 800ms)
  speechThreshold?: number; // Base energy threshold multiplier (default: 1.0)
  minSpeechDurationMs?: number; // Ignore very short clicks/coughs (<250ms)
}

export class VadAudioProcessor {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private animFrameId: number | null = null;

  private isSpeaking = false;
  private speechStartTime = 0;
  private lastSpeechTime = 0;
  private isMuted = false;
  private isRunning = false;

  private lastTurnEndTime = 0;

  private preRollChunks: { blob: Blob; time: number }[] = [];
  private activeChunks: Blob[] = [];

  private noiseFloor = 0.015;
  private callbacks: VadCallbacks;
  private config: Required<VadConfig>;

  constructor(callbacks: VadCallbacks, config: VadConfig = {}) {
    this.callbacks = callbacks;
    this.config = {
      silenceTimeoutMs: config.silenceTimeoutMs ?? 800,
      speechThreshold: config.speechThreshold ?? 1.0,
      minSpeechDurationMs: config.minSpeechDurationMs ?? 300,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access (getUserMedia) is not available');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioContextClass();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.25;
    this.source.connect(this.analyser);

    // Setup MediaRecorder for audio capture
    let mimeType = 'audio/webm';
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/wav')) {
        mimeType = 'audio/wav';
      }
    }

    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        const now = Date.now();
        if (this.isSpeaking) {
          this.activeChunks.push(e.data);
        } else {
          // Keep a ~400ms rolling pre-roll buffer so starting syllables aren't lost
          this.preRollChunks.push({ blob: e.data, time: now });
          const cutoff = now - 500;
          this.preRollChunks = this.preRollChunks.filter(c => c.time >= cutoff);
        }
      }
    };

    this.mediaRecorder.start(100); // 100ms chunk frequency
    this.isRunning = true;
    this.processAudioLoop();
  }

  private processAudioLoop = () => {
    if (!this.isRunning || !this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);

    // Compute RMS amplitude
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);

    // Adaptive noise floor tracking during silence
    if (!this.isSpeaking && !this.isMuted) {
      this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
    }

    const threshold = Math.max(0.025, this.noiseFloor * 2.2 * this.config.speechThreshold);
    const now = Date.now();

    // Scale audio level for visualizer
    const visualLevel = this.isMuted ? 0 : Math.min(1.0, Math.max(0, (rms - this.noiseFloor) * 8.0));
    this.callbacks.onAudioLevel(visualLevel);

    if (!this.isMuted) {
      if (rms > threshold) {
        // User is currently speaking (enforce 500ms refractory cooldown between turns)
        if (!this.isSpeaking && now - this.lastTurnEndTime >= 500) {
          this.isSpeaking = true;
          this.speechStartTime = now;
          this.lastSpeechTime = now;
          // Seed activeChunks with rolling pre-roll chunks
          this.activeChunks = this.preRollChunks.map(c => c.blob);
          this.preRollChunks = [];
          this.callbacks.onSpeechStart();
        } else if (this.isSpeaking) {
          this.lastSpeechTime = now;
        }
      } else if (this.isSpeaking) {
        // User is silent after speaking
        const silenceDuration = now - this.lastSpeechTime;
        if (silenceDuration >= this.config.silenceTimeoutMs) {
          const totalSpeechDuration = this.lastSpeechTime - this.speechStartTime;
          this.isSpeaking = false;
          this.lastTurnEndTime = now;

          if (totalSpeechDuration >= this.config.minSpeechDurationMs && this.activeChunks.length > 0) {
            const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
            const audioBlob = new Blob(this.activeChunks, { type: mimeType });
            this.activeChunks = [];
            this.callbacks.onSpeechEnd(audioBlob);
          } else {
            // Speech was too brief (e.g. click/breath), discard
            this.activeChunks = [];
          }
        }
      }
    }

    this.animFrameId = requestAnimationFrame(this.processAudioLoop);
  };

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.stream) {
      this.stream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
    if (muted && this.isSpeaking) {
      this.isSpeaking = false;
      this.activeChunks = [];
    }
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  setSensitivity(multiplier: number): void {
    this.config.speechThreshold = multiplier > 0 ? multiplier : 1.0;
  }

  stop(): void {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore recorder stop error during shutdown
      }
      this.mediaRecorder = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.isSpeaking = false;
    this.activeChunks = [];
    this.preRollChunks = [];
  }
}
