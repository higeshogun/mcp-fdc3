import type { AIConfig } from './types';

export const DEFAULT_TTS_URL = '/api/tts/audio/speech';
export const DEFAULT_TTS_VOICE = 'Aiden';
export const DEFAULT_TTS_MODEL = 'Qwen/Qwen3-TTS-12Hz-0.6B-Base';

let currentAudio: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;

/**
 * Clean markdown symbols, code fences, and raw json from text so TTS reads naturally.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  return text
    // Remove markdown code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Remove header symbols (#, ##, etc.)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers (*, _, ~~)
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    // Remove bullet points
    .replace(/^[\*\-+]\s+/gm, '')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Collapse excess whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stops any currently active TTS audio playback or browser speech synthesis.
 */
export function stopAllSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    if (currentUtterance || window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    currentUtterance = null;
  }
}

/**
 * Fallback to Browser native WebSpeech SpeechSynthesis.
 */
function speakWithBrowser(
  text: string,
  onStateChange?: (playing: boolean) => void
): () => void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    console.warn('[TTS] SpeechSynthesis is not supported in this browser.');
    onStateChange?.(false);
    return () => {};
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  utterance.onstart = () => {
    onStateChange?.(true);
  };
  utterance.onend = () => {
    onStateChange?.(false);
    currentUtterance = null;
  };
  utterance.onerror = (e) => {
    console.warn('[TTS] Browser SpeechSynthesis error:', e);
    onStateChange?.(false);
    currentUtterance = null;
  };

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);

  return () => {
    window.speechSynthesis.cancel();
    onStateChange?.(false);
    currentUtterance = null;
  };
}

/**
 * Synthesizes and plays speech using the TTS server or Browser fallback.
 */
export async function playTextToSpeech(
  rawText: string,
  config: AIConfig,
  onStateChange?: (playing: boolean) => void
): Promise<() => void> {
  const text = cleanTextForSpeech(rawText);
  if (!text) {
    onStateChange?.(false);
    return () => {};
  }

  stopAllSpeech();

  const provider = config.ttsProvider || 'ttsServer';
  if (provider === 'none') {
    onStateChange?.(false);
    return () => {};
  }

  // 1. If configured for Browser TTS directly
  if (provider === 'browser') {
    return speakWithBrowser(text, onStateChange);
  }

  // 2. Try TTS Server (OpenAI compatible /v1/audio/speech)
  let url = config.ttsUrl?.trim() || DEFAULT_TTS_URL;
  if (url.startsWith('https://tts.kumatech.net/v1')) {
    url = url.replace('https://tts.kumatech.net/v1', '/api/tts');
  } else if (url === 'https://tts.kumatech.net' || url === 'https://tts.kumatech.net/') {
    url = '/api/tts/audio/speech';
  } else if (!url.endsWith('/speech') && !url.includes('/audio/speech')) {
    url = url.replace(/\/+$/, '') + '/audio/speech';
  }

  const apiKey = config.ttsApiKey?.trim() || config.apiKey?.trim() || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    onStateChange?.(true);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.ttsModel?.trim() || DEFAULT_TTS_MODEL,
        input: text,
        voice: config.ttsVoice?.trim() || DEFAULT_TTS_VOICE,
        response_format: 'wav',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[TTS] Server error (${res.status}): ${errBody}. Falling back to Browser TTS.`);
      return speakWithBrowser(text, onStateChange);
    }

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    audio.onended = () => {
      onStateChange?.(false);
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) currentAudio = null;
    };

    audio.onerror = (e) => {
      console.warn('[TTS] Audio playback error:', e, 'Falling back to browser TTS');
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) currentAudio = null;
      speakWithBrowser(text, onStateChange);
    };

    await audio.play();

    return () => {
      audio.pause();
      audio.currentTime = 0;
      URL.revokeObjectURL(audioUrl);
      onStateChange?.(false);
      if (currentAudio === audio) currentAudio = null;
    };
  } catch (err) {
    console.warn('[TTS] Failed to reach TTS server, falling back to Browser TTS:', err);
    return speakWithBrowser(text, onStateChange);
  }
}
