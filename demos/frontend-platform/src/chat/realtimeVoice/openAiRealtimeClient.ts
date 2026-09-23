/**
 * OpenAI Realtime-Compatible WebSocket Client
 * 
 * Directly connects to OpenAI Realtime-compatible speech-to-speech servers
 * (such as Hugging Face / Kumatech Realtime endpoint).
 * Supports bidirectional streaming audio, server VAD, function calling (WebMCP tools),
 * and zero-latency barge-in interruptions.
 */

import { getWebMcpClient } from '../../mcp/webMcpServer';
import { isMcpFdc3Resource, handleMcpFdc3Resource } from '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js';
import type { PoorMansFdc3Agent } from '../../fdc3-agent/PoorMansFdc3Agent.js';
import type { VoiceSessionState } from './VoiceOrbVisualizer';
import type { Interaction, McpResource } from '../types';

export const DEFAULT_OPENAI_REALTIME_WS_URL = 'wss://hf-s2s.kumatech.net/v1/realtime';
export const REALTIME_AUDIO_SAMPLE_RATE = 16000;

/**
 * Resamples a Float32Array to target sample rate using linear interpolation
 */
function resampleAudio(input: Float32Array, inputSampleRate: number, targetSampleRate: number = 16000): Float32Array {
  if (inputSampleRate === targetSampleRate || !inputSampleRate) return input;
  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const origin = i * ratio;
    const index = Math.floor(origin);
    const frac = origin - index;
    const next = Math.min(index + 1, input.length - 1);
    result[i] = input[index] * (1 - frac) + input[next] * frac;
  }
  return result;
}

export interface OpenAiRealtimeCallbacks {
  onStateChange: (state: VoiceSessionState) => void;
  onAudioLevel: (level: number) => void;
  onUserTranscript: (text: string) => void;
  onAgentTranscript: (text: string) => void;
  onInteractionAdded: (interaction: Interaction) => void;
  onError: (error: string) => void;
}

export class OpenAiRealtimeClient {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;

  private outputAudioCtx: AudioContext | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private nextPlayTime = 0;
  private activeAudioSources: AudioBufferSourceNode[] = [];

  private isMuted = false;
  private isConnected = false;
  private state: VoiceSessionState = 'idle';

  private wsUrl: string;
  private apiKey: string;
  private fdc3Agent: PoorMansFdc3Agent;
  private callbacks: OpenAiRealtimeCallbacks;

  private currentAgentTranscript = '';
  private currentUserTranscript = '';
  private lastFdc3Resource: unknown = null;
  private systemInstruction?: string;

  private isResponseActive = false;
  private pendingResponseCreate = false;
  private processedCallIds = new Set<string>();
  private vocalBargeInFrames = 0;

  constructor(
    wsUrl: string,
    apiKey: string,
    fdc3Agent: PoorMansFdc3Agent,
    callbacks: OpenAiRealtimeCallbacks,
    systemInstruction?: string
  ) {
    this.wsUrl = wsUrl || DEFAULT_OPENAI_REALTIME_WS_URL;
    this.apiKey = apiKey || '';
    this.fdc3Agent = fdc3Agent;
    this.callbacks = callbacks;
    this.systemInstruction = systemInstruction;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    this.setState('idle');

    // 1. Initialize Microhpone Stream
    await this.initMicrophone();

    // 2. Initialize Output Audio Context
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.outputAudioCtx = new AudioContextClass();
    if (this.outputAudioCtx.state === 'suspended') {
      await this.outputAudioCtx.resume();
    }
    this.outputAnalyser = this.outputAudioCtx.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputAnalyser.connect(this.outputAudioCtx.destination);

    // 3. Connect WebSocket
    return new Promise((resolve, reject) => {
      try {
        let connectUrl = this.wsUrl;
        let protocols: string[] | undefined;

        if (connectUrl.includes('api.openai.com')) {
          if (this.apiKey) {
            protocols = ['realtime', `openai-insecure-api-key.${this.apiKey}`, 'openai-beta.realtime-v1'];
          }
        } else if (this.apiKey) {
          const separator = connectUrl.includes('?') ? '&' : '?';
          connectUrl = `${connectUrl}${separator}api_key=${encodeURIComponent(this.apiKey)}`;
        }

        console.log(`[Realtime WebSocket] Connecting to: ${this.wsUrl}`);
        this.ws = protocols ? new WebSocket(connectUrl, protocols) : new WebSocket(connectUrl);

        this.ws.onopen = async () => {
          console.log('[Realtime WebSocket] Connection established.');
          this.isConnected = true;
          this.setState('listening');
          await this.sendSessionUpdate();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleServerMessage(event.data);
        };

        this.ws.onerror = (e) => {
          console.error('[Realtime WebSocket] WebSocket error:', e);
          const detail = this.wsUrl.startsWith('ws://') && window.location.protocol === 'https:' && !this.wsUrl.includes('localhost') && !this.wsUrl.includes('127.0.0.1')
            ? `Mixed Content: Browsers block unencrypted ws:// from https://. Use wss:// or test with localhost.`
            : `WebSocket connection error (${this.wsUrl}). Check server status and URL.`;
          this.callbacks.onError(detail);
          reject(new Error(detail));
        };

        this.ws.onclose = (e) => {
          console.log('[Realtime WebSocket] Closed:', e.code, e.reason);
          this.isConnected = false;
          this.stop();
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to connect WebSocket';
        reject(new Error(msg));
      }
    });
  }

  private async initMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser.');
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
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

    this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.micSource.connect(this.analyser);

    // ScriptProcessor to capture PCM16 samples and stream to WebSocket
    this.micProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.micProcessor.onaudioprocess = (e) => {
      if (!this.isConnected || this.isMuted) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Compute input level for visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      const level = Math.min(1.0, rms * 6);
      if (this.state === 'listening' || this.state === 'idle') {
        this.callbacks.onAudioLevel(level);
      }

      // Vocal Barge-in Detection:
      // If the assistant is speaking and user speaks into the microphone (rms > 0.02),
      // immediately cut off assistant playback and signal interruption without needing a button!
      if (this.state === 'speaking') {
        if (rms > 0.02) {
          this.vocalBargeInFrames++;
          if (this.vocalBargeInFrames >= 2) {
            console.log('[OpenAI Realtime] Vocal barge-in detected from microphone energy! Interrupting playback.');
            this.interruptPlayback();
            this.setState('interrupted');
            this.vocalBargeInFrames = 0;
            setTimeout(() => {
              if (this.state === 'interrupted') {
                this.setState('listening');
              }
            }, 300);
          }
        } else {
          this.vocalBargeInFrames = 0;
          if (rms < 0.008) {
            return; // Suppress slight ambient speaker bleed while speaking
          }
        }
      } else {
        this.vocalBargeInFrames = 0;
      }

      // Resample to 16000Hz PCM16 (matching backend ASR pipeline sample rate)
      const resampled = resampleAudio(inputData, this.audioCtx ? this.audioCtx.sampleRate : REALTIME_AUDIO_SAMPLE_RATE, REALTIME_AUDIO_SAMPLE_RATE);
      const pcm16 = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) {
        const s = Math.max(-1, Math.min(1, resampled[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Encode to base64 and send
      const base64Audio = this.arrayBufferToBase64(pcm16.buffer);
      this.send({
        type: 'input_audio_buffer.append',
        audio: base64Audio,
      });
    };

    this.micSource.connect(this.micProcessor);
    this.micProcessor.connect(this.audioCtx.destination);
  }

  private async sendSessionUpdate(): Promise<void> {
    const client = await getWebMcpClient();
    const { tools } = await client.listTools();

    const toolsSchema = tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    }));

    const defaultInstructions =
      'You are an intelligent financial voice assistant demonstrating an FDC3 interop desktop application. You have access to real-time tools for switching workspace views and focusing tabs (switchView: chart, watchlist, news, rfq, order-ticket, account, positions, orders blotter, trade blotter, chat), retrieving trades (getTrades), viewing/filtering news by ticker, topic, or bullish/bearish sentiment (getNews), interactive charting with durations like 1D, 1W, 1M, 3M, 1Y and styles (viewChart), adding/removing watchlist instruments (addToWatchlist, removeFromWatchlist), submitting and executing orders by voice (submitOrder), staging and preparing orders in the order ticket for review without executing (stageOrder), cancelling active/pending orders on the blotter (cancelOrder), retrieving current positions and exposure (getPositions), checking account balance, equity, and P&L (getAccountSummary), requesting quotes (requestQuote), and resetting desktop filters (clearFilters). When the user asks to switch views, or asks about trades, news, charts, quotes, submitting, staging, or cancelling orders, positions, account balance, watchlist changes, or filter resets, always invoke the appropriate tool. Speak concisely and conversationally.';
    const effectiveInstructions = this.systemInstruction?.trim() || defaultInstructions;

    this.send({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: effectiveInstructions,
        voice: 'Aiden',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 650,
        },
        input_audio_transcription: {
          model: 'whisper-1',
        },
        tools: toolsSchema,
      },
    });
  }

  private async handleServerMessage(rawData: string | Blob | ArrayBuffer): Promise<void> {
    try {
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const type = data.type;

      switch (type) {
        case 'input_audio_buffer.speech_started': {
          console.log('[OpenAI Realtime] Server detected speech start! (Barge-in)');
          this.interruptPlayback();
          this.setState('interrupted');
          setTimeout(() => {
            if (this.state === 'interrupted') {
              this.setState('listening');
            }
          }, 350);
          break;
        }

        case 'input_audio_buffer.speech_stopped': {
          console.log('[OpenAI Realtime] Server detected speech end. Processing turn...');
          this.setState('processing');
          break;
        }

        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.delta': {
          const transcript = data.transcript || data.text || data.delta;
          if (transcript) {
            if (type.endsWith('.delta')) {
              this.currentUserTranscript += transcript;
            } else {
              this.currentUserTranscript = transcript;
            }
            console.log(`[OpenAI Realtime] User Transcript: "${this.currentUserTranscript}"`);
            this.callbacks.onUserTranscript(this.currentUserTranscript);
          }
          break;
        }

        // Support both Hugging Face S2S and standard OpenAI transcript deltas
        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta': {
          const delta = data.delta || data.text;
          if (delta) {
            this.currentAgentTranscript += delta;
            this.callbacks.onAgentTranscript(this.currentAgentTranscript);
          }
          break;
        }

        // Support both Hugging Face S2S and standard OpenAI audio deltas
        case 'response.output_audio.delta':
        case 'response.audio.delta': {
          const delta = data.delta || data.audio;
          if (delta) {
            this.setState('speaking');
            this.playPcm16Chunk(delta);
          }
          break;
        }

        case 'response.created': {
          this.isResponseActive = true;
          break;
        }

        case 'response.output_audio.done':
        case 'response.audio.done': {
          console.log('[OpenAI Realtime] Output audio stream completed.');
          break;
        }

        case 'response.function_call_arguments.done': {
          const callId = data.call_id || data.item_id || `call_${Date.now()}`;
          if (this.processedCallIds.has(callId)) {
            console.log(`[OpenAI Realtime] Ignoring duplicate tool call '${callId}'`);
            break;
          }
          this.processedCallIds.add(callId);

          const fnName = data.name || data.item?.name;
          if (!fnName) break;

          let fnArgs: Record<string, unknown> = {};
          try {
            const rawArgs = data.arguments || data.item?.arguments;
            fnArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs || {};
          } catch (e) {
            console.warn('[OpenAI Realtime] Failed to parse tool arguments:', e);
          }

          console.log(`[OpenAI Realtime] Executing WebMCP tool '${fnName}' with args:`, fnArgs);
          await this.executeWebMcpTool(callId, fnName, fnArgs);
          break;
        }

        case 'response.done': {
          console.log('[OpenAI Realtime] Turn response completed.');
          this.isResponseActive = false;

          // If a tool output was submitted while this response was still finishing, trigger next response now
          if (this.pendingResponseCreate) {
            this.pendingResponseCreate = false;
            console.log('[OpenAI Realtime] Executing deferred response.create after response.done');
            this.send({
              type: 'response.create',
            });
          }

          // If the model finished speaking or answered
          if (this.currentAgentTranscript || this.currentUserTranscript) {
            this.callbacks.onInteractionAdded({
              question: this.currentUserTranscript || 'Voice Command',
              response: { content: this.currentAgentTranscript },
              finalAnswer: this.currentAgentTranscript,
              mcpResource: this.lastFdc3Resource as McpResource | undefined,
            });
            // Reset for next turn
            this.currentUserTranscript = '';
            this.currentAgentTranscript = '';
            this.lastFdc3Resource = null;
          }
          break;
        }

        case 'response.cancelled': {
          this.isResponseActive = false;
          this.pendingResponseCreate = false;
          break;
        }

        case 'error': {
          console.error('[OpenAI Realtime] Server error event:', data.error);
          const msg = data.error?.message || '';
          // Ignore harmless / expected protocol race condition errors
          if (
            msg.includes('another response is in progress') ||
            msg.includes('already has an active response') ||
            msg.includes('no active response to cancel') ||
            data.error?.code === 'response_already_in_progress'
          ) {
            console.log(`[OpenAI Realtime] Handled transient protocol notification: ${msg}`);
            break;
          }
          this.callbacks.onError(msg || 'Realtime API error');
          this.setState('listening');
          break;
        }
      }
    } catch (e) {
      console.warn('[OpenAI Realtime] Failed parsing server event:', e);
    }
  }

  private async executeWebMcpTool(callId: string, fnName: string, fnArgs: Record<string, unknown>): Promise<void> {
    const client = await getWebMcpClient();
    try {
      const result = (await client.callTool({
        name: fnName,
        arguments: fnArgs,
      })) as { content?: Array<{ type: string; text?: string; resource?: McpResource }> };

      let toolText = '';
      if (Array.isArray(result?.content)) {
        for (const item of result.content) {
          if (item.type === 'text') {
            toolText += (toolText ? '\n' : '') + item.text;
          } else if (item.type === 'resource' && item.resource) {
            this.lastFdc3Resource = item.resource;
            if (isMcpFdc3Resource(item.resource)) {
              handleMcpFdc3Resource(this.fdc3Agent, item.resource);
            }
          }
        }
      }

      if (!this.lastFdc3Resource) {
        const fallbackRes = (result as any)?.fdc3Resource?.resource || (result as any)?.fdc3Resource || (result as any)?._meta?.fdc3?.resource || (result as any)?._meta?.fdc3;
        if (fallbackRes && isMcpFdc3Resource(fallbackRes)) {
          this.lastFdc3Resource = fallbackRes;
          handleMcpFdc3Resource(this.fdc3Agent, fallbackRes);
        }
      }

      if (!toolText) {
        toolText = `Successfully executed ${fnName}`;
      }

      // Return function call output to OpenAI Realtime session
      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: toolText,
        },
      });

      // Request next turn synthesis only if no response is currently active, or defer until response.done
      if (!this.isResponseActive) {
        this.send({
          type: 'response.create',
        });
      } else {
        console.log('[OpenAI Realtime] Response currently active; deferring response.create until response.done');
        this.pendingResponseCreate = true;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Tool execution failed';
      console.error(`[OpenAI Realtime] Error executing tool ${fnName}:`, err);

      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: errMsg }),
        },
      });

      if (!this.isResponseActive) {
        this.send({
          type: 'response.create',
        });
      } else {
        this.pendingResponseCreate = true;
      }
    }
  }

  private playPcm16Chunk(base64Data: string): void {
    if (!this.outputAudioCtx) return;

    try {
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      const audioBuffer = this.outputAudioCtx.createBuffer(1, float32.length, REALTIME_AUDIO_SAMPLE_RATE);
      audioBuffer.getChannelData(0).set(float32);

      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = audioBuffer;

      if (this.outputAnalyser) {
        source.connect(this.outputAnalyser);
      } else {
        source.connect(this.outputAudioCtx.destination);
      }

      const currentTime = this.outputAudioCtx.currentTime;
      const startTime = Math.max(currentTime, this.nextPlayTime);
      source.start(startTime);
      this.nextPlayTime = startTime + audioBuffer.duration;
      this.activeAudioSources.push(source);

      source.onended = () => {
        const idx = this.activeAudioSources.indexOf(source);
        if (idx !== -1) {
          this.activeAudioSources.splice(idx, 1);
        }
        if (this.activeAudioSources.length === 0 && this.state === 'speaking') {
          this.setState('listening');
          this.callbacks.onAudioLevel(0);
        }
      };

      // Pulse visualizer
      const fakeLevel = 0.4 + Math.random() * 0.4;
      this.callbacks.onAudioLevel(fakeLevel);
    } catch (err) {
      console.warn('[OpenAI Realtime] Failed playing audio chunk:', err);
    }
  }

  interruptPlayback(): void {
    // Send response.cancel to server only if a response is actively in progress
    if (this.isConnected && this.isResponseActive) {
      this.send({ type: 'response.cancel' });
      this.isResponseActive = false;
    }
    this.pendingResponseCreate = false;

    // Stop all playing audio sources
    for (const source of this.activeAudioSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Source already stopped
      }
    }
    this.activeAudioSources = [];

    if (this.outputAudioCtx) {
      this.nextPlayTime = this.outputAudioCtx.currentTime;
    }

    this.callbacks.onAudioLevel(0);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  private send(eventObj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(eventObj));
    }
  }

  private setState(state: VoiceSessionState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  stop(): void {
    this.isConnected = false;
    this.interruptPlayback();

    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor = null;
    }

    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.outputAudioCtx && this.outputAudioCtx.state !== 'closed') {
      this.outputAudioCtx.close().catch(() => {});
      this.outputAudioCtx = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore WS close errors
      }
      this.ws = null;
    }

    this.setState('idle');
  }
}
