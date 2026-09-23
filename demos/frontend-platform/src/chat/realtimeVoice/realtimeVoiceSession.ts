import type { AIConfig, Interaction } from '../types';
import type { PoorMansFdc3Agent } from '../../fdc3-agent/PoorMansFdc3Agent.js';
import { isMcpFdc3Resource, handleMcpFdc3Resource } from '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js';
import { VadAudioProcessor } from './vadAudioProcessor';
import { transcribeAudioWithWhisper, DEFAULT_WHISPER_URL } from '../whisperAsr';
import { runBrowserAgent } from '../browserAgent';
import { playTextToSpeech, stopAllSpeech } from '../ttsEngine';
import type { VoiceSessionState } from './VoiceOrbVisualizer';
import { OpenAiRealtimeClient, DEFAULT_OPENAI_REALTIME_WS_URL } from './openAiRealtimeClient';
import { OpenAiWebRtcClient, DEFAULT_OPENAI_REALTIME_WEBRTC_URL } from './openAiWebRtcClient';
import { GeminiLiveClient } from './geminiLiveClient';

export interface VoiceSessionCallbacks {
  onStateChange: (state: VoiceSessionState) => void;
  onAudioLevel: (level: number) => void;
  onUserTranscript: (text: string) => void;
  onAgentTranscript?: (text: string) => void;
  onAgentResponse: (text: string) => void;
  onInteractionAdded: (interaction: Interaction) => void;
  onError: (error: string) => void;
}

export class RealtimeVoiceSession {
  private vad: VadAudioProcessor | null = null;
  private realtimeWsClient: OpenAiRealtimeClient | null = null;
  private realtimeWebRtcClient: OpenAiWebRtcClient | null = null;
  private geminiLiveClient: GeminiLiveClient | null = null;
  private state: VoiceSessionState = 'idle';
  private currentAbortController: AbortController | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private stopSpeechPlayback: (() => void) | null = null;

  private fdc3Agent: PoorMansFdc3Agent;
  private aiConfig: AIConfig;
  private sessionId: string;
  private callbacks: VoiceSessionCallbacks;
  private isMuted = false;
  private isActive = false;

  constructor(
    sessionId: string,
    fdc3Agent: PoorMansFdc3Agent,
    aiConfig: AIConfig,
    callbacks: VoiceSessionCallbacks
  ) {
    this.sessionId = sessionId;
    this.fdc3Agent = fdc3Agent;
    this.aiConfig = aiConfig;
    this.callbacks = callbacks;
  }

  updateConfig(config: AIConfig): void {
    this.aiConfig = config;
    if (this.vad && config.vadSensitivity) {
      this.vad.setSensitivity(config.vadSensitivity);
    }
  }

  async start(): Promise<void> {
    if (this.isActive) return;
    this.isActive = true;

    const engine = this.aiConfig.realtimeEngine || 'websocket';

    if (engine === 'websocket' || engine === 'openai-realtime') {
      const transport = this.aiConfig.realtimeTransport || 'websocket';

      if (transport === 'webrtc') {
        try {
          const endpointUrl = this.aiConfig.realtimeWsUrl?.trim() || DEFAULT_OPENAI_REALTIME_WEBRTC_URL;
          const apiKey = this.aiConfig.realtimeApiKey?.trim() || this.aiConfig.apiKey?.trim() || '';

          console.log(`[Realtime Voice] Initializing OpenAI Realtime WebRTC: ${endpointUrl}`);
          this.realtimeWebRtcClient = new OpenAiWebRtcClient(
            endpointUrl,
            apiKey,
            this.fdc3Agent,
            {
              onStateChange: (state) => this.setState(state),
              onAudioLevel: (level) => this.callbacks.onAudioLevel(level),
              onUserTranscript: (text) => this.callbacks.onUserTranscript(text),
              onAgentTranscript: (text) => this.callbacks.onAgentResponse(text),
              onInteractionAdded: (interaction) => this.callbacks.onInteractionAdded(interaction),
              onError: (err) => {
                console.warn('[Realtime Voice] WebRTC client error:', err);
                this.callbacks.onError(err);
              },
            },
            this.aiConfig.systemPrompt
          );

          await this.realtimeWebRtcClient.connect();
          return;
        } catch (webrtcErr: unknown) {
          const msg = webrtcErr instanceof Error ? webrtcErr.message : 'Failed to connect OpenAI Realtime WebRTC';
          console.error('[Realtime Voice] Failed to connect OpenAI Realtime WebRTC:', webrtcErr);
          this.realtimeWebRtcClient = null;
          this.isActive = false;
          this.setState('idle');
          this.callbacks.onError(`Realtime WebRTC connection failed: ${msg}`);
          return;
        }
      } else {
        try {
          const wsUrl = this.aiConfig.realtimeWsUrl?.trim() || DEFAULT_OPENAI_REALTIME_WS_URL;
          const apiKey = this.aiConfig.realtimeApiKey?.trim() || this.aiConfig.apiKey?.trim() || '';

          console.log(`[Realtime Voice] Initializing OpenAI Realtime WebSocket: ${wsUrl}`);
          this.realtimeWsClient = new OpenAiRealtimeClient(
            wsUrl,
            apiKey,
            this.fdc3Agent,
            {
              onStateChange: (state) => this.setState(state),
              onAudioLevel: (level) => this.callbacks.onAudioLevel(level),
              onUserTranscript: (text) => this.callbacks.onUserTranscript(text),
              onAgentTranscript: (text) => this.callbacks.onAgentResponse(text),
              onInteractionAdded: (interaction) => this.callbacks.onInteractionAdded(interaction),
              onError: (err) => {
                console.warn('[Realtime Voice] WebSocket client error:', err);
                this.callbacks.onError(err);
              },
            },
            this.aiConfig.systemPrompt
          );

          await this.realtimeWsClient.connect();
          return;
        } catch (wsErr: unknown) {
          const msg = wsErr instanceof Error ? wsErr.message : 'Failed to connect OpenAI Realtime WS';
          console.error('[Realtime Voice] Failed to connect OpenAI Realtime WS:', wsErr);
          this.realtimeWsClient = null;
          this.isActive = false;
          this.setState('idle');
          this.callbacks.onError(`Realtime connection failed: ${msg}`);
          return;
        }
      }
    }

    if (engine === 'gemini-live') {
      try {
        const apiKey = this.aiConfig.geminiApiKey?.trim() || this.aiConfig.apiKey?.trim() || '';
        if (!apiKey) {
          throw new Error('Gemini API Key is required. Please set it in ⚙️ AI Settings.');
        }

        console.log('[Realtime Voice] Initializing Gemini Live WebSocket...');
        this.geminiLiveClient = new GeminiLiveClient(
          {
            apiKey,
            model: this.aiConfig.geminiModel || 'gemini-2.0-flash-exp',
            voiceName: this.aiConfig.geminiVoice || 'Puck',
            systemInstruction: this.aiConfig.systemPrompt,
          },
          this.fdc3Agent,
          {
            onStateChange: (state) => this.setState(state),
            onAudioLevel: (level) => this.callbacks.onAudioLevel(level),
            onUserTranscript: (text) => this.callbacks.onUserTranscript(text),
            onAgentTranscript: (text) => this.callbacks.onAgentResponse(text),
            onInteractionAdded: (interaction) => this.callbacks.onInteractionAdded(interaction),
            onError: (err) => {
              console.warn('[Realtime Voice] Gemini Live error:', err);
              this.callbacks.onError(err);
            },
          }
        );

        await this.geminiLiveClient.connect();
        return;
      } catch (geminiErr: unknown) {
        const msg = geminiErr instanceof Error ? geminiErr.message : 'Failed to connect Gemini Live';
        console.error('[Realtime Voice] Failed to connect Gemini Live:', geminiErr);
        this.geminiLiveClient = null;
        this.isActive = false;
        this.setState('idle');
        this.callbacks.onError(`Gemini Live connection failed: ${msg}`);
        return;
      }
    }

    this.setState('listening');

    this.vad = new VadAudioProcessor(
      {
        onSpeechStart: () => {
          this.handleSpeechStart();
        },
        onSpeechEnd: (audioBlob) => {
          this.handleSpeechEnd(audioBlob);
        },
        onAudioLevel: (level) => {
          if (this.state === 'listening') {
            this.callbacks.onAudioLevel(level);
          }
        },
        onError: (err) => {
          this.callbacks.onError(err.message);
        },
      },
      {
        speechThreshold: this.aiConfig.vadSensitivity ?? 1.0,
        silenceTimeoutMs: 750,
      }
    );

    try {
      await this.vad.start();
    } catch (err: unknown) {
      this.isActive = false;
      this.setState('idle');
      throw err;
    }
  }

  /**
   * Called the instant user begins speaking into the microphone.
   * If agent is currently speaking or processing, immediately trigger BARGE-IN (Interruption)!
   */
  private handleSpeechStart(): void {
    if (this.state === 'speaking' || this.state === 'processing') {
      console.log('[Realtime Voice] Barge-in detected! User interrupted agent.');
      this.cancelCurrentOutput();
      this.setState('interrupted');
      setTimeout(() => {
        if (this.isActive && this.state === 'interrupted') {
          this.setState('listening');
        }
      }, 350);
    }
  }

  /**
   * Called when user finishes speaking (silence detected).
   */
  private async handleSpeechEnd(audioBlob: Blob): Promise<void> {
    if (!this.isActive || this.isMuted) return;

    this.setState('processing');
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    try {
      await this.processWithPipeline(audioBlob, signal);
    } catch (err: unknown) {
      if (signal.aborted) {
        console.log('[Realtime Voice] Turn aborted by user interruption.');
        return;
      }
      console.error('[Realtime Voice] Turn processing error:', err);
      const errMsg = err instanceof Error ? err.message : 'Voice turn processing failed';
      this.callbacks.onError(errMsg);
      this.setState('listening');
    }
  }

  /**
   * Process user speech via Agent Pipeline:
   * Whisper ASR -> BrowserAgent (executes FDC3 tools!) -> TTS playback
   */
  private async processWithPipeline(audioBlob: Blob, signal: AbortSignal): Promise<void> {
    // 1. Transcribe audio with Whisper
    const whisperUrl = this.aiConfig.whisperUrl?.trim() || DEFAULT_WHISPER_URL;
    const userText = await transcribeAudioWithWhisper(audioBlob, { whisperUrl });

    if (signal.aborted) return;

    if (!userText || !userText.trim()) {
      // Empty / background noise
      this.setState('listening');
      return;
    }

    console.log(`[Realtime Voice] Transcribed: "${userText}"`);
    this.callbacks.onUserTranscript(userText);

    // 2. Run BrowserAgent (with FDC3 tools!)
    const structuredMessage = await runBrowserAgent(this.sessionId, userText, this.aiConfig);

    if (signal.aborted) return;

    // 3. Handle FDC3 resource (broadcast, open chart, submit order, etc.)
    if (isMcpFdc3Resource(structuredMessage.mcpResource)) {
      handleMcpFdc3Resource(this.fdc3Agent, structuredMessage.mcpResource);
    }

    const answer = structuredMessage.finalAnswer || structuredMessage.textContent || 'Done.';
    this.callbacks.onAgentResponse(answer);

    this.callbacks.onInteractionAdded({
      question: userText,
      response: { messages: [structuredMessage] },
      finalAnswer: answer,
      mcpResource: structuredMessage.mcpResource,
    });

    // 4. Speak response aloud
    await this.speakText(answer, signal);
  }

  /**
   * Plays synthesized text via TTS and updates visualizer state.
   */
  private speakText(text: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      this.setState('speaking');

      // Simulate output audio levels for visualizer while speaking
      const levelInterval = setInterval(() => {
        if (this.state === 'speaking') {
          const fakeLevel = 0.35 + Math.random() * 0.45;
          this.callbacks.onAudioLevel(fakeLevel);
        }
      }, 80);

      playTextToSpeech(text, this.aiConfig, (isPlaying) => {
        if (!isPlaying) {
          clearInterval(levelInterval);
          this.callbacks.onAudioLevel(0);
          if (this.state === 'speaking') {
            this.setState('listening');
          }
          resolve();
        }
      }).then((stopFn) => {
        this.stopSpeechPlayback = () => {
          clearInterval(levelInterval);
          stopFn();
          resolve();
        };
      }).catch((err) => {
        console.warn('[Realtime Voice] TTS playback failed:', err);
        clearInterval(levelInterval);
        this.setState('listening');
        resolve();
      });
    });
  }


  /**
   * Immediately stops any speech output or pending requests.
   */
  cancelCurrentOutput(): void {
    if (this.realtimeWsClient) {
      this.realtimeWsClient.interruptPlayback();
    }

    if (this.realtimeWebRtcClient) {
      this.realtimeWebRtcClient.interruptPlayback();
    }

    if (this.geminiLiveClient) {
      this.geminiLiveClient.interruptPlayback();
    }

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement.currentTime = 0;
      this.currentAudioElement = null;
    }

    if (this.stopSpeechPlayback) {
      this.stopSpeechPlayback();
      this.stopSpeechPlayback = null;
    }

    stopAllSpeech();
    this.callbacks.onAudioLevel(0);
  }

  /**
   * Manual interrupt button action.
   */
  interrupt(): void {
    this.cancelCurrentOutput();
    this.setState('interrupted');
    setTimeout(() => {
      if (this.isActive) {
        this.setState('listening');
      }
    }, 400);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.realtimeWsClient) {
      this.realtimeWsClient.setMuted(muted);
    }
    if (this.realtimeWebRtcClient) {
      this.realtimeWebRtcClient.setMuted(muted);
    }
    if (this.geminiLiveClient) {
      this.geminiLiveClient.setMuted(muted);
    }
    if (this.vad) {
      this.vad.setMuted(muted);
    }
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  private setState(state: VoiceSessionState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  stop(): void {
    this.isActive = false;
    this.cancelCurrentOutput();
    if (this.realtimeWsClient) {
      this.realtimeWsClient.stop();
      this.realtimeWsClient = null;
    }
    if (this.realtimeWebRtcClient) {
      this.realtimeWebRtcClient.stop();
      this.realtimeWebRtcClient = null;
    }
    if (this.geminiLiveClient) {
      this.geminiLiveClient.stop();
      this.geminiLiveClient = null;
    }
    if (this.vad) {
      this.vad.stop();
      this.vad = null;
    }
    this.setState('idle');
  }
}
