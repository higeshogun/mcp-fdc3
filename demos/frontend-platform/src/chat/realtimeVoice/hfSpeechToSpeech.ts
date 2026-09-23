/**
 * Hugging Face Speech-to-Speech (S2S) Client
 * 
 * Communicates with Hugging Face Inference Endpoints, Spaces, or Custom S2S endpoints.
 * Users can update the default endpoint URL here or customize it directly in AI Settings.
 */

// HARDCODED DEFAULT HF ENDPOINT FOR TESTING
// You can set this to your direct Hugging Face Space URL (e.g. https://xxxx.hf.space/run/predict)
export const DEFAULT_HF_S2S_URL = 'https://router.huggingface.co/hf-inference';
export const DEFAULT_HF_API_KEY = '';

export interface HfS2sResult {
  audioBlob?: Blob;
  text?: string;
  durationMs?: number;
}

/**
 * Sends recorded user speech audio to the Hugging Face Speech-to-Speech endpoint.
 * Handles binary audio responses as well as JSON payloads containing base64 audio or text.
 */
export async function sendAudioToHfS2s(
  audioBlob: Blob,
  options: {
    endpointUrl?: string;
    apiKey?: string;
    signal?: AbortSignal;
  } = {}
): Promise<HfS2sResult> {
  const url = options.endpointUrl?.trim() || DEFAULT_HF_S2S_URL;
  const apiKey = options.apiKey?.trim() || DEFAULT_HF_API_KEY;

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Determine payload shape: FormData or raw binary audio
  // Most HF Spaces & Inference API models accept multipart/form-data with a file or binary audio
  let body: BodyInit;
  if (url.includes('/run/predict') || url.includes('/call/predict')) {
    // Gradio Space API format
    const base64Data = await blobToBase64(audioBlob);
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({
      data: [
        {
          name: 'audio.wav',
          data: base64Data,
        },
      ],
    });
  } else {
    // Standard audio multipart / binary upload
    const formData = new FormData();
    formData.append('file', audioBlob, 'input.wav');
    formData.append('audio', audioBlob, 'input.wav');
    body = formData;
  }

  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: options.signal,
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF S2S Endpoint error (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const contentType = response.headers.get('content-type') || '';

  // 1. Direct Audio Response
  if (
    contentType.includes('audio') ||
    contentType.includes('octet-stream') ||
    contentType.includes('application/ogg')
  ) {
    const audioBlob = await response.blob();
    return {
      audioBlob,
      durationMs,
    };
  }

  // 2. JSON Response (e.g. Gradio output, base64 audio, or transcribed / generated text)
  const json = await response.json();

  // Check if JSON contains audio base64 or url
  if (json?.data && Array.isArray(json.data)) {
    // Gradio style response
    const firstOutput = json.data[0];
    if (typeof firstOutput === 'string' && firstOutput.startsWith('data:audio/')) {
      const audioBlob = await dataUrlToBlob(firstOutput);
      return { audioBlob, durationMs };
    } else if (firstOutput?.name && firstOutput?.data) {
      const audioBlob = await dataUrlToBlob(firstOutput.data);
      return { audioBlob, text: json.data[1] || undefined, durationMs };
    }
  }

  if (json?.audio_base64) {
    const audioBlob = await base64ToBlob(json.audio_base64, json.mime_type || 'audio/wav');
    return {
      audioBlob,
      text: json.text || json.transcript,
      durationMs,
    };
  }

  // Text response only
  const text = json?.text || json?.generated_text || (Array.isArray(json) && json[0]?.generated_text) || JSON.stringify(json);
  return {
    text,
    durationMs,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function base64ToBlob(base64: string, mimeType = 'audio/wav'): Promise<Blob> {
  const byteCharacters = atob(base64.replace(/^data:[^;]+;base64,/, ''));
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
