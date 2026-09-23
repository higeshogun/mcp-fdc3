/**
 * Google Gemini Multimodal Live WebSocket Client
 * 
 * Directly connects to Gemini Multimodal Live API:
 * wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}
 * 
 * Supports:
 * - Bidirectional streaming audio (16kHz mic input -> 24kHz model output)
 * - Built-in zero-latency barge-in interruption (serverContent.interrupted)
 * - FDC3 WebMCP Tool Execution (toolCall / toolResponse)
 */

import { getWebMcpClient } from '../../mcp/webMcpServer';
import { isMcpFdc3Resource, handleMcpFdc3Resource } from '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js';
import type { PoorMansFdc3Agent } from '../../fdc3-agent/PoorMansFdc3Agent.js';
import type { VoiceSessionState } from './VoiceOrbVisualizer';
import type { Interaction, McpResource } from '../types';

export const GEMINI_LIVE_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const GEMINI_MIC_SAMPLE_RATE = 16000;
export const GEMINI_PLAYBACK_SAMPLE_RATE = 24000;

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

export interface GeminiLiveCallbacks {
  onStateChange: (state: VoiceSessionState) => void;
  onAudioLevel: (level: number) => void;
  onUserTranscript: (text: string) => void;
  onAgentTranscript: (text: string) => void;
  onInteractionAdded: (interaction: Interaction) => void;
  onError: (error: string) => void;
}

export interface GeminiLiveConfig {
  apiKey: string;
  model?: string;
  voiceName?: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede';
  systemInstruction?: string;
}

export class GeminiLiveClient {
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
  private isSetupComplete = false;
  private state: VoiceSessionState = 'idle';

  private config: GeminiLiveConfig;
  private fdc3Agent: PoorMansFdc3Agent;
  private callbacks: GeminiLiveCallbacks;

  private currentAgentTranscript = '';
  private currentUserTranscript = '';
  private lastFdc3Resource: unknown = null;
  private vocalBargeInFrames = 0;

  constructor(
    config: GeminiLiveConfig,
    fdc3Agent: PoorMansFdc3Agent,
    callbacks: GeminiLiveCallbacks
  ) {
    this.config = config;
    this.fdc3Agent = fdc3Agent;
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    this.setState('idle');

    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) {
      const err = 'Google Gemini API Key is required for Gemini Live. Please configure it in ⚙️ AI Settings.';
      this.callbacks.onError(err);
      throw new Error(err);
    }

    // 1. Initialize Microphone Stream
    await this.initMicrophone();

    // 2. Initialize Output Audio Context (24,000 Hz for Gemini audio)
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.outputAudioCtx = new AudioContextClass({ sampleRate: GEMINI_PLAYBACK_SAMPLE_RATE });
    if (this.outputAudioCtx.state === 'suspended') {
      await this.outputAudioCtx.resume();
    }
    this.outputAnalyser = this.outputAudioCtx.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputAnalyser.connect(this.outputAudioCtx.destination);

    // 3. Connect WebSocket
    return new Promise((resolve, reject) => {
      try {
        const connectUrl = `${GEMINI_LIVE_WS_BASE}?key=${encodeURIComponent(apiKey)}`;
        console.log('[Gemini Live] Connecting to WebSocket...');
        this.ws = new WebSocket(connectUrl);

        this.ws.onopen = async () => {
          console.log('[Gemini Live] WebSocket connection established.');
          this.isConnected = true;
          try {
            await this.sendSetupMessage();
            this.setState('listening');
            resolve();
          } catch (setupErr) {
            reject(setupErr);
          }
        };

        this.ws.onmessage = async (event) => {
          let messageData = event.data;
          if (messageData instanceof Blob) {
            messageData = await messageData.text();
          }
          this.handleServerMessage(messageData);
        };

        this.ws.onerror = (e) => {
          console.error('[Gemini Live] WebSocket error event:', e);
          const errText = 'Gemini Live WebSocket connection error. Please verify your Gemini API key, network, or model name.';
          this.callbacks.onError(errText);
          reject(new Error(errText));
        };

        this.ws.onclose = (e) => {
          console.log(`[Gemini Live] WebSocket closed. Code: ${e.code}, Reason: "${e.reason}", Clean: ${e.wasClean}`);
          this.isConnected = false;
          this.isSetupComplete = false;
          if (e.code !== 1000) {
            const reasonMsg = e.reason ? ` (Reason: ${e.reason})` : '';
            this.callbacks.onError(`Gemini Live connection closed (code ${e.code})${reasonMsg}. Check your Gemini API key or model name in ⚙️ AI Settings.`);
          }
          this.stop();
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to connect Gemini Live WS';
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

    // ScriptProcessor to capture PCM16 samples and stream to Gemini Live
    this.micProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.micProcessor.onaudioprocess = (e) => {
      if (!this.isConnected || !this.isSetupComplete || this.isMuted) return;

      const inputData = e.inputBuffer.getChannelData(0);

      // Compute input audio level for visualizer
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
            console.log('[Gemini Live] Vocal barge-in detected from microphone energy! Interrupting playback.');
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

      // Resample to 16,000 Hz PCM16
      const resampled = resampleAudio(
        inputData,
        this.audioCtx ? this.audioCtx.sampleRate : GEMINI_MIC_SAMPLE_RATE,
        GEMINI_MIC_SAMPLE_RATE
      );
      const pcm16 = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) {
        const s = Math.max(-1, Math.min(1, resampled[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      // Encode to base64 and send to Gemini Live
      // Note: BidiGenerateContent has deprecated media_chunks in favor of audio object
      const base64Audio = this.arrayBufferToBase64(pcm16.buffer);
      this.send({
        realtimeInput: {
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        },
      });
    };

    this.micSource.connect(this.micProcessor);
    this.micProcessor.connect(this.audioCtx.destination);
  }

  /**
   * Cleans and formats standard JSONSchema into OpenAPI 3.0 compatible Schema for Gemini Live
   */
  private cleanOpenApiSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const copy = { ...schema };
    delete copy['$schema'];
    delete copy['additionalProperties'];
    if (copy.type && typeof copy.type === 'string') {
      copy.type = copy.type.toUpperCase();
    }
    if (copy.properties && typeof copy.properties === 'object') {
      const props: Record<string, any> = {};
      for (const [k, v] of Object.entries(copy.properties)) {
        props[k] = this.cleanOpenApiSchema(v);
      }
      copy.properties = props;
    }
    if (copy.items) {
      copy.items = this.cleanOpenApiSchema(copy.items);
    }
    return copy;
  }

  /**
   * Send the initial Gemini Live Setup message with tools and speech configuration.
   */
  private async sendSetupMessage(): Promise<void> {
    const client = await getWebMcpClient();
    const { tools } = await client.listTools();

    // Map WebMCP tools to Gemini Live function declarations
    const functionDeclarations = tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      parameters: this.cleanOpenApiSchema(t.inputSchema) || { type: 'OBJECT', properties: {} },
    }));

    const modelName = this.config.model?.startsWith('models/') 
      ? this.config.model 
      : `models/${this.config.model || 'gemini-2.0-flash-exp'}`;

    const voiceName = this.config.voiceName || 'Puck';

    console.log(`[Gemini Live] Sending setup message for model ${modelName}, voice: ${voiceName}, with ${functionDeclarations.length} tools`);

    const defaultInstruction = 'You are an intelligent financial voice assistant demonstrating an FDC3 interop desktop application. You have access to real-time tools for switching workspace views and focusing tabs (switchView: chart, watchlist, news, rfq, order-ticket, account, positions, orders blotter, trade blotter, chat), retrieving trades (getTrades), viewing/filtering news by ticker, topic, or bullish/bearish sentiment (getNews), interactive charting with durations like 1D, 1W, 1M, 3M, 1Y and styles (viewChart), adding/removing watchlist instruments (addToWatchlist, removeFromWatchlist), submitting and executing orders by voice (submitOrder), staging and preparing orders in the order ticket for review without executing (stageOrder), cancelling active/pending orders on the blotter (cancelOrder), retrieving current positions and exposure (getPositions), checking account balance, equity, and P&L (getAccountSummary), requesting quotes (requestQuote), and resetting desktop filters (clearFilters). When the user asks to switch views, or asks about trades, news, charts, quotes, submitting, staging, or cancelling orders, positions, account balance, watchlist changes, or filter resets, always invoke the appropriate tool. Answer conversationally, accurately, and concisely.';
    const systemPromptText = this.config.systemInstruction?.trim() || defaultInstruction;

    this.send({
      setup: {
        model: modelName,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName,
              },
            },
          },
        },
        systemInstruction: {
          parts: [
            {
              text: systemPromptText,
            },
          ],
        },
        tools: [
          {
            functionDeclarations: functionDeclarations,
          },
        ],
      },
    });

    this.isSetupComplete = true;
  }

  private async handleServerMessage(rawData: string | ArrayBuffer): Promise<void> {
    try {
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

      // Handle explicit error payload from Gemini
      if (data.error) {
        console.error('[Gemini Live] Server error received:', data.error);
        const errMsg = data.error.message || JSON.stringify(data.error);
        this.callbacks.onError(`Gemini Live error: ${errMsg}`);
        return;
      }

      // 1. Handle Setup Complete confirmation
      if (data.setupComplete) {
        console.log('[Gemini Live] Setup complete acknowledged by server.');
        return;
      }

      // 2. Handle Server Content (audio chunks, text transcripts, turn completion, interruption)
      if (data.serverContent) {
        const serverContent = data.serverContent;

        // Barge-in Interruption detected by Gemini
        if (serverContent.interrupted) {
          console.log('[Gemini Live] Gemini detected user interruption! Stopping playback.');
          this.interruptPlayback();
          this.setState('interrupted');
          setTimeout(() => {
            if (this.state === 'interrupted') {
              this.setState('listening');
            }
          }, 350);
          return;
        }

        // Model turn content
        if (serverContent.modelTurn?.parts) {
          for (const part of serverContent.modelTurn.parts) {
            // Text transcript part
            if (part.text) {
              this.currentAgentTranscript += part.text;
              this.callbacks.onAgentTranscript(this.currentAgentTranscript);
            }

            // Audio stream part (Gemini audio is 24,000 Hz PCM16)
            if (part.inlineData?.data) {
              this.setState('speaking');
              this.playPcm16Chunk(part.inlineData.data);
            }
          }
        }

        // Turn complete
        if (serverContent.turnComplete) {
          console.log('[Gemini Live] Turn completed.');
          if (this.currentAgentTranscript || this.currentUserTranscript) {
            this.callbacks.onInteractionAdded({
              question: this.currentUserTranscript || 'Voice Command',
              response: { content: this.currentAgentTranscript },
              finalAnswer: this.currentAgentTranscript,
              mcpResource: this.lastFdc3Resource as McpResource | undefined,
            });
            this.currentUserTranscript = '';
            this.currentAgentTranscript = '';
            this.lastFdc3Resource = null;
          }
        }
      }

      // 3. Handle Tool Calls (WebMCP FDC3 function execution)
      if (data.toolCall?.functionCalls) {
        this.setState('processing');
        console.log(`[Gemini Live] Received ${data.toolCall.functionCalls.length} function call(s)`);

        const functionResponses: Array<{ id: string; response: { output: Record<string, unknown> } }> = [];

        for (const call of data.toolCall.functionCalls) {
          const callId = call.id;
          const fnName = call.name;
          const fnArgs = (call.args || {}) as Record<string, unknown>;

          console.log(`[Gemini Live] Executing tool '${fnName}' with args:`, fnArgs);
          const toolResult = await this.executeWebMcpTool(fnName, fnArgs);

          functionResponses.push({
            id: callId,
            response: {
              output: {
                result: toolResult,
              },
            },
          });
        }

        // Send toolResponse back to Gemini Live
        this.send({
          toolResponse: {
            functionResponses: functionResponses,
          },
        });
      }
    } catch (err) {
      console.warn('[Gemini Live] Error handling server message:', err);
    }
  }

  private async executeWebMcpTool(fnName: string, fnArgs: Record<string, unknown>): Promise<string> {
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

      return toolText || `Successfully executed ${fnName}`;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Tool execution failed';
      console.error(`[Gemini Live] Error executing tool ${fnName}:`, err);
      return JSON.stringify({ error: errMsg });
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

      const audioBuffer = this.outputAudioCtx.createBuffer(1, float32.length, GEMINI_PLAYBACK_SAMPLE_RATE);
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

      // Visualizer energy
      const fakeLevel = 0.4 + Math.random() * 0.4;
      this.callbacks.onAudioLevel(fakeLevel);
    } catch (err) {
      console.warn('[Gemini Live] Failed playing audio chunk:', err);
    }
  }

  interruptPlayback(): void {
    for (const source of this.activeAudioSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Already ended
      }
    }
    this.activeAudioSources = [];

    if (this.outputAudioCtx) {
      this.nextPlayTime = this.outputAudioCtx.currentTime;
    }

    this.callbacks.onAudioLevel(0);
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.callbacks.onAudioLevel(0);
    }
  }

  getIsMuted(): boolean {
    return this.isMuted;
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
    this.interruptPlayback();
    this.setState('idle');

    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor.onaudioprocess = null;
      this.micProcessor = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    if (this.outputAudioCtx) {
      this.outputAudioCtx.close().catch(() => {});
      this.outputAudioCtx = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isSetupComplete = false;
  }
}
