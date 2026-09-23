export const DEFAULT_WHISPER_URL = '/api/whisper/audio/transcriptions';

export interface WhisperOptions {
  whisperUrl?: string;
  model?: string;
}

/**
 * Transcribes an audio blob using OpenAI-compatible Whisper ASR endpoint.
 */
export async function transcribeAudioWithWhisper(
  audioBlob: Blob,
  options: WhisperOptions = {}
): Promise<string> {
  let url = options.whisperUrl?.trim() || DEFAULT_WHISPER_URL;

  // If pointing to the direct Whisper domain from a browser, route through the same-origin proxy to eliminate CORS errors
  if (url.startsWith('https://whisper.kumatech.net/v1')) {
    url = url.replace('https://whisper.kumatech.net/v1', '/api/whisper');
  }

  // Ensure full path to audio/transcriptions if only base is provided
  if (!url.endsWith('/transcriptions') && !url.includes('/audio/transcriptions')) {
    url = url.replace(/\/+$/, '') + '/audio/transcriptions';
  }

  const model = options.model?.trim() || 'whisper-1';

  const formData = new FormData();
  // Ensure a valid extension based on mime type (iOS Safari produces mp4/aac, Chrome produces webm)
  let extension = 'webm';
  if (audioBlob.type.includes('mp4') || audioBlob.type.includes('aac')) {
    extension = 'mp4';
  } else if (audioBlob.type.includes('wav')) {
    extension = 'wav';
  } else if (audioBlob.type.includes('ogg')) {
    extension = 'ogg';
  }

  formData.append('file', audioBlob, `recording.${extension}`);
  formData.append('model', model);
  formData.append('response_format', 'json');

  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Whisper ASR error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return (data?.text || '').trim();
}

/**
 * Helper to record audio from the microphone using MediaRecorder.
 */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('MediaDevices API not available in this browser context');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioChunks = [];

    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/aac')) {
        mimeType = 'audio/aac';
      } else if (MediaRecorder.isTypeSupported('audio/wav')) {
        mimeType = 'audio/wav';
      }
    }

    const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
    this.mediaRecorder = new MediaRecorder(this.stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.start(250); // Slice into 250ms chunks
  }

  async stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        return reject(new Error('Recorder not started'));
      }

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        
        // Stop all audio tracks
        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop());
          this.stream = null;
        }
        this.mediaRecorder = null;
        this.audioChunks = [];
        resolve(audioBlob);
      };

      this.mediaRecorder.onerror = (e) => {
        reject(e);
      };

      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    });
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }
}
