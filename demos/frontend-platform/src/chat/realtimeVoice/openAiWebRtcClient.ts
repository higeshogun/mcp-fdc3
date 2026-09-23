/**
 * OpenAI Realtime-Compatible WebRTC Client
 * 
 * Implements WebRTC transport for OpenAI Realtime-compatible speech-to-speech servers
 * (such as Hugging Face / Kumatech Realtime endpoint / OpenAI Realtime calls API).
 * 
 * Audio flows natively over RTP media tracks (Opus/PCM) with minimal latency and no base64 overhead.
 * Events and WebMCP function calls flow over the 'oai-events' RTCDataChannel using
 * the standard OpenAI Realtime JSON protocol.
 */

import { getWebMcpClient } from '../../mcp/webMcpServer';
import { isMcpFdc3Resource, handleMcpFdc3Resource } from '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js';
import type { PoorMansFdc3Agent } from '../../fdc3-agent/PoorMansFdc3Agent.js';
import type { VoiceSessionState } from './VoiceOrbVisualizer';
import type { McpResource } from '../types';
import type { OpenAiRealtimeCallbacks } from './openAiRealtimeClient';

export const DEFAULT_OPENAI_REALTIME_WEBRTC_URL = 'https://hf-s2s.kumatech.net/v1/realtime/calls';

export class OpenAiWebRtcClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;

  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;

  private isMuted = false;
  private isConnected = false;
  private state: VoiceSessionState = 'idle';

  private endpointUrl: string;
  private apiKey: string;
  private fdc3Agent: PoorMansFdc3Agent;
  private callbacks: OpenAiRealtimeCallbacks;
  private systemInstruction?: string;

  private currentAgentTranscript = '';
  private currentUserTranscript = '';
  private lastFdc3Resource: unknown = null;

  private isResponseActive = false;
  private pendingResponseCreate = false;
  private processedCallIds = new Set<string>();
  private vocalBargeInFrames = 0;

  constructor(
    endpointUrl: string,
    apiKey: string,
    fdc3Agent: PoorMansFdc3Agent,
    callbacks: OpenAiRealtimeCallbacks,
    systemInstruction?: string
  ) {
    this.endpointUrl = endpointUrl || DEFAULT_OPENAI_REALTIME_WEBRTC_URL;
    this.apiKey = apiKey || '';
    this.fdc3Agent = fdc3Agent;
    this.callbacks = callbacks;
    this.systemInstruction = systemInstruction;
  }

  /**
   * Resolves the WebRTC SDP handshake endpoint URL.
   * Converts WebSocket URL to HTTP/HTTPS and ensures endpoint path matches /calls
   */
  private resolveCallsUrl(): string {
    let url = this.endpointUrl.trim();
    if (url.startsWith('wss://')) {
      url = url.replace(/^wss:\/\//, 'https://');
    } else if (url.startsWith('ws://')) {
      url = url.replace(/^ws:\/\//, 'http://');
    }

    // Auto-map /v1/realtime to /v1/realtime/calls if /calls not explicitly present
    if (url.endsWith('/v1/realtime') || url.endsWith('/v1/realtime/')) {
      url = url.replace(/\/v1\/realtime\/?$/, '/v1/realtime/calls');
    }

    return url;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    this.setState('idle');

    // 1. Initialize Microphone MediaStream and level analyzer
    await this.initMicrophone();

    // 2. Setup Remote Audio Element for RTP track playback
    this.remoteAudioEl = document.createElement('audio');
    this.remoteAudioEl.autoplay = true;
    (this.remoteAudioEl as any).playsInline = true;

    // 3. Initialize RTCPeerConnection
    const callsUrl = this.resolveCallsUrl();
    console.log(`[Realtime WebRTC] Initializing connection to: ${callsUrl}`);

    return new Promise(async (resolve, reject) => {
      try {
        this.pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        // Add local microphone audio track to WebRTC connection
        if (this.micStream) {
          const audioTrack = this.micStream.getAudioTracks()[0];
          if (audioTrack) {
            this.pc.addTrack(audioTrack, this.micStream);
          }
        }

        // Handle incoming remote audio track from server
        this.pc.ontrack = (event) => {
          console.log('[Realtime WebRTC] Received remote audio track.');
          if (this.remoteAudioEl) {
            const stream = event.streams[0] || new MediaStream([event.track]);
            this.remoteAudioEl.srcObject = stream;
            this.remoteAudioEl.play().catch((err) => {
              console.warn('[Realtime WebRTC] Remote audio playback error:', err);
            });
          }
        };

        this.pc.onconnectionstatechange = () => {
          console.log('[Realtime WebRTC] Connection state:', this.pc?.connectionState);
          if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'disconnected') {
            if (this.isConnected) {
              this.callbacks.onError('WebRTC connection disconnected.');
              this.stop();
            }
          }
        };

        // Create 'oai-events' RTCDataChannel for OpenAI Realtime JSON protocol
        this.dc = this.pc.createDataChannel('oai-events');

        this.dc.onopen = async () => {
          console.log('[Realtime WebRTC] oai-events data channel open.');
          this.isConnected = true;
          this.setState('listening');
          await this.sendSessionUpdate();
          resolve();
        };

        this.dc.onmessage = (event) => {
          this.handleServerMessage(event.data);
        };

        this.dc.onerror = (event) => {
          console.error('[Realtime WebRTC] DataChannel error:', event);
          this.callbacks.onError('WebRTC data channel error.');
        };

        this.dc.onclose = () => {
          console.log('[Realtime WebRTC] DataChannel closed.');
          this.isConnected = false;
          this.stop();
        };

        // Create SDP Offer
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        // Wait for ICE gathering to complete or timeout after 750ms
        await this.waitForIceGathering();

        const localSdp = this.pc.localDescription?.sdp || offer.sdp;
        console.log('[Realtime WebRTC] POSTing SDP offer to server...');

        const headers: Record<string, string> = {
          'Content-Type': 'application/sdp',
        };
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(callsUrl, {
          method: 'POST',
          headers,
          body: localSdp,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const detail = `WebRTC SDP handshake failed (${response.status}): ${errorText.slice(0, 300)}`;
          console.error('[Realtime WebRTC]', detail);
          this.callbacks.onError(detail);
          reject(new Error(detail));
          return;
        }

        const answerSdp = await response.text();
        console.log('[Realtime WebRTC] Setting remote description (SDP answer)...');
        await this.pc.setRemoteDescription({
          type: 'answer',
          sdp: answerSdp,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to establish WebRTC connection';
        console.error('[Realtime WebRTC] Setup error:', err);
        this.callbacks.onError(msg);
        reject(new Error(msg));
      }
    });
  }

  private async waitForIceGathering(): Promise<void> {
    if (!this.pc || this.pc.iceGatheringState === 'complete') return;

    return new Promise<void>((resolve) => {
      const checkState = () => {
        if (!this.pc || this.pc.iceGatheringState === 'complete') {
          if (this.pc) this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      if (this.pc) {
        this.pc.addEventListener('icegatheringstatechange', checkState);
      }

      // Fallback timeout to avoid waiting too long
      setTimeout(() => {
        if (this.pc) this.pc.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 750);
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

    // Meter input level for visualizer & detect vocal barge-in
    this.micProcessor = this.audioCtx.createScriptProcessor(2048, 1, 1);
    this.micProcessor.onaudioprocess = (e) => {
      if (!this.isConnected || this.isMuted) return;

      const inputData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      const level = Math.min(1.0, rms * 6);
      if (this.state === 'listening' || this.state === 'idle') {
        this.callbacks.onAudioLevel(level);
      }

      // Vocal barge-in detection:
      // If the agent is speaking and user speaks into mic, interrupt agent immediately!
      if (this.state === 'speaking') {
        if (rms > 0.02) {
          this.vocalBargeInFrames++;
          if (this.vocalBargeInFrames >= 2) {
            console.log('[Realtime WebRTC] Vocal barge-in detected! Interrupting agent speech.');
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
        }
      } else {
        this.vocalBargeInFrames = 0;
      }
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
          console.log('[Realtime WebRTC] Server detected speech start! (Barge-in)');
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
          console.log('[Realtime WebRTC] Server detected speech end. Processing turn...');
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
            console.log(`[Realtime WebRTC] User Transcript: "${this.currentUserTranscript}"`);
            this.callbacks.onUserTranscript(this.currentUserTranscript);
          }
          break;
        }

        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta': {
          const delta = data.delta || data.text;
          if (delta) {
            this.currentAgentTranscript += delta;
            this.callbacks.onAgentTranscript(this.currentAgentTranscript);
          }
          break;
        }

        case 'response.created': {
          this.isResponseActive = true;
          this.setState('speaking');
          break;
        }

        case 'response.output_audio.done':
        case 'response.audio.done': {
          console.log('[Realtime WebRTC] Output audio stream completed.');
          break;
        }

        case 'response.function_call_arguments.done': {
          const callId = data.call_id || data.item_id || `call_${Date.now()}`;
          if (this.processedCallIds.has(callId)) {
            console.log(`[Realtime WebRTC] Ignoring duplicate tool call '${callId}'`);
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
            console.warn('[Realtime WebRTC] Failed to parse tool arguments:', e);
          }

          console.log(`[Realtime WebRTC] Executing WebMCP tool '${fnName}' with args:`, fnArgs);
          await this.executeWebMcpTool(callId, fnName, fnArgs);
          break;
        }

        case 'response.done': {
          console.log('[Realtime WebRTC] Turn response completed.');
          this.isResponseActive = false;
          this.setState('listening');

          if (this.pendingResponseCreate) {
            this.pendingResponseCreate = false;
            console.log('[Realtime WebRTC] Executing deferred response.create after response.done');
            this.send({ type: 'response.create' });
          }

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
          break;
        }

        case 'response.cancelled': {
          this.isResponseActive = false;
          this.pendingResponseCreate = false;
          this.setState('listening');
          break;
        }

        case 'error': {
          console.error('[Realtime WebRTC] Server error event:', data.error);
          const msg = data.error?.message || '';
          if (
            msg.includes('another response is in progress') ||
            msg.includes('already has an active response') ||
            msg.includes('no active response to cancel') ||
            data.error?.code === 'response_already_in_progress'
          ) {
            console.log(`[Realtime WebRTC] Handled transient protocol notification: ${msg}`);
            break;
          }
          this.callbacks.onError(msg || 'WebRTC Realtime API error');
          this.setState('listening');
          break;
        }
      }
    } catch (e) {
      console.warn('[Realtime WebRTC] Failed parsing server event:', e);
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
          if (item.text) {
            toolText += item.text;
          }
          if (item.resource && isMcpFdc3Resource(item.resource)) {
            this.lastFdc3Resource = item.resource;
            handleMcpFdc3Resource(this.fdc3Agent, item.resource);
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
        toolText = JSON.stringify(result || { status: 'success' });
      }

      console.log(`[Realtime WebRTC] Tool '${fnName}' executed. Result:`, toolText.slice(0, 120));

      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: toolText,
        },
      });

      if (this.isResponseActive) {
        console.log('[Realtime WebRTC] Deferring response.create until active response completes');
        this.pendingResponseCreate = true;
      } else {
        this.send({
          type: 'response.create',
        });
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : 'Tool execution error';
      console.error(`[Realtime WebRTC] Tool '${fnName}' failed:`, errMessage);

      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: errMessage }),
        },
      });

      if (this.isResponseActive) {
        this.pendingResponseCreate = true;
      } else {
        this.send({
          type: 'response.create',
        });
      }
    }
  }

  send(event: Record<string, unknown>): void {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(event));
    } else {
      console.warn('[Realtime WebRTC] Cannot send event, data channel is not open:', event.type);
    }
  }

  interruptPlayback(): void {
    if (this.remoteAudioEl) {
      this.remoteAudioEl.pause();
      this.remoteAudioEl.currentTime = 0;
    }

    if (this.isConnected && this.isResponseActive) {
      try {
        this.send({ type: 'response.cancel' });
      } catch (e) {
        console.warn('[Realtime WebRTC] Error sending response.cancel:', e);
      }
    }

    this.isResponseActive = false;
    this.pendingResponseCreate = false;
    this.currentAgentTranscript = '';
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  private setState(state: VoiceSessionState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  stop(): void {
    this.isConnected = false;
    this.interruptPlayback();

    if (this.dc) {
      try {
        this.dc.close();
      } catch (e) {
        // ignore
      }
      this.dc = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch (e) {
        // ignore
      }
      this.pc = null;
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }

    if (this.micProcessor) {
      this.micProcessor.disconnect();
      this.micProcessor = null;
    }

    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }

    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }

    if (this.remoteAudioEl) {
      this.remoteAudioEl.srcObject = null;
      this.remoteAudioEl = null;
    }

    this.setState('idle');
  }
}
