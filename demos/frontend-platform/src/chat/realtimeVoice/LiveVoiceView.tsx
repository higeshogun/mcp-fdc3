import React, { useEffect, useRef, useState } from 'react';
import type { AIConfig, Interaction } from '../types';
import type { PoorMansFdc3Agent } from '../../fdc3-agent/PoorMansFdc3Agent.js';
import { RealtimeVoiceSession } from './realtimeVoiceSession';
import { VoiceOrbVisualizer, type VoiceSessionState } from './VoiceOrbVisualizer';
import { DEFAULT_OPENAI_REALTIME_WS_URL } from './openAiRealtimeClient';
import { DEFAULT_OPENAI_REALTIME_WEBRTC_URL } from './openAiWebRtcClient';

interface LiveVoiceViewProps {
  sessionId: string;
  fdc3Agent: PoorMansFdc3Agent;
  aiConfig: AIConfig;
  onUpdateAiConfig: (config: AIConfig) => void;
  onSwitchToText: () => void;
  onOpenSettings: () => void;
  onInteractionAdded: (interaction: Interaction) => void;
}

export const LiveVoiceView: React.FC<LiveVoiceViewProps> = ({
  sessionId,
  fdc3Agent,
  aiConfig,
  onUpdateAiConfig,
  onSwitchToText,
  onOpenSettings,
  onInteractionAdded,
}) => {
  const [sessionState, setSessionState] = useState<VoiceSessionState>('idle');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [agentResponse, setAgentResponse] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showWsConfig, setShowWsConfig] = useState<boolean>(false);
  const defaultUrl = aiConfig.realtimeTransport === 'webrtc' ? DEFAULT_OPENAI_REALTIME_WEBRTC_URL : DEFAULT_OPENAI_REALTIME_WS_URL;
  const [wsUrlInput, setWsUrlInput] = useState<string>(aiConfig.realtimeWsUrl || defaultUrl);

  useEffect(() => {
    if (aiConfig.realtimeWsUrl) {
      setWsUrlInput(aiConfig.realtimeWsUrl);
    } else {
      setWsUrlInput(aiConfig.realtimeTransport === 'webrtc' ? DEFAULT_OPENAI_REALTIME_WEBRTC_URL : DEFAULT_OPENAI_REALTIME_WS_URL);
    }
  }, [aiConfig.realtimeWsUrl, aiConfig.realtimeTransport]);

  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const aiConfigRef = useRef(aiConfig);
  aiConfigRef.current = aiConfig;
  const onInteractionAddedRef = useRef(onInteractionAdded);
  onInteractionAddedRef.current = onInteractionAdded;

  useEffect(() => {
    let session: RealtimeVoiceSession;
    try {
      session = new RealtimeVoiceSession(
        sessionId,
        fdc3Agent,
        aiConfigRef.current,
        {
          onStateChange: (state) => setSessionState(state),
          onAudioLevel: (level) => setAudioLevel(level),
          onUserTranscript: (text) => setUserTranscript(text),
          onAgentResponse: (text) => setAgentResponse(text),
          onInteractionAdded: (interaction) => onInteractionAddedRef.current(interaction),
          onError: (err) => setErrorMessage(err),
        }
      );
      sessionRef.current = session;

      session.start().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to start microphone or voice session';
        setErrorMessage(msg);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Initialization error';
      setErrorMessage(msg);
    }

    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, [
    sessionId,
    fdc3Agent,
    aiConfig.realtimeEngine,
    aiConfig.realtimeTransport,
    aiConfig.geminiApiKey,
    aiConfig.geminiModel,
    aiConfig.geminiVoice,
    aiConfig.systemPrompt,
    aiConfig.realtimeWsUrl,
    aiConfig.realtimeApiKey,
    aiConfig.apiKey,
    aiConfig.ttsAutoPlay,
  ]);

  // Auto-dismiss transient errors after 4 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Clear errors when conversation makes active progress
  useEffect(() => {
    if (userTranscript || sessionState === 'speaking' || sessionState === 'processing') {
      setErrorMessage(null);
    }
  }, [userTranscript, sessionState]);

  useEffect(() => {
    if (sessionRef.current) {
      sessionRef.current.updateConfig(aiConfig);
    }
  }, [aiConfig]);

  const toggleMute = () => {
    if (sessionRef.current) {
      const next = !isMuted;
      sessionRef.current.setMuted(next);
      setIsMuted(next);
    }
  };

  const handleInterrupt = () => {
    if (sessionRef.current) {
      sessionRef.current.interrupt();
    }
  };

  const getStatusBadge = () => {
    switch (sessionState) {
      case 'listening':
        return isMuted ? (
          <span className="voice-status-pill muted">🔇 Mic Muted</span>
        ) : (
          <span className="voice-status-pill listening">🟢 Open Mic (Listening)</span>
        );
      case 'processing':
        return <span className="voice-status-pill processing">🟡 Thinking...</span>;
      case 'speaking':
        return <span className="voice-status-pill speaking">🔊 Agent Speaking</span>;
      case 'interrupted':
        return <span className="voice-status-pill interrupted">⚡ Interrupted!</span>;
      default:
        return <span className="voice-status-pill idle">⚪ Connecting...</span>;
    }
  };

  return (
    <div className="live-voice-container">
      {/* Top Header & Engine Selector */}
      <div className="live-voice-header">
        <div className="live-voice-title-row">
          <div className="live-voice-title">
            <span className="live-pulse-dot" />
            Live Voice Agent
          </div>
          {getStatusBadge()}
        </div>

        <div className="live-voice-engine-row">
          <label className="live-engine-label">Engine:</label>
          <select
            className="live-engine-select"
            value={aiConfig.realtimeEngine === 'openai-realtime' ? 'websocket' : (aiConfig.realtimeEngine || 'websocket')}
            onChange={(e) => {
              const engine = e.target.value as 'websocket' | 'gemini-live' | 'pipeline';
              onUpdateAiConfig({ ...aiConfig, realtimeEngine: engine });
            }}
          >
            <option value="websocket">Realtime S2S (OpenAI Protocol)</option>
            <option value="gemini-live">Gemini Live (Google Multimodal Live)</option>
            <option value="pipeline">In-Browser Pipeline (Whisper + WebMCP + TTS)</option>
          </select>
          {(aiConfig.realtimeEngine === 'websocket' || aiConfig.realtimeEngine === 'openai-realtime' || !aiConfig.realtimeEngine) && (
            <>
              <div className="live-transport-toggle-group">
                <button
                  type="button"
                  className={`live-transport-btn ${aiConfig.realtimeTransport !== 'webrtc' ? 'active' : ''}`}
                  onClick={() => {
                    let nextUrl = aiConfig.realtimeWsUrl;
                    if (!nextUrl || nextUrl === DEFAULT_OPENAI_REALTIME_WEBRTC_URL || nextUrl.includes('hf-s2s.kumatech.net')) {
                      nextUrl = DEFAULT_OPENAI_REALTIME_WS_URL;
                    }
                    onUpdateAiConfig({ ...aiConfig, realtimeTransport: 'websocket', realtimeWsUrl: nextUrl });
                  }}
                  title="WebSocket mode: bidirectional base64 PCM"
                >
                  WS
                </button>
                <button
                  type="button"
                  className={`live-transport-btn ${aiConfig.realtimeTransport === 'webrtc' ? 'active' : ''}`}
                  onClick={() => {
                    let nextUrl = aiConfig.realtimeWsUrl;
                    if (!nextUrl || nextUrl === DEFAULT_OPENAI_REALTIME_WS_URL || nextUrl.includes('hf-s2s.kumatech.net')) {
                      nextUrl = DEFAULT_OPENAI_REALTIME_WEBRTC_URL;
                    }
                    onUpdateAiConfig({ ...aiConfig, realtimeTransport: 'webrtc', realtimeWsUrl: nextUrl });
                  }}
                  title="WebRTC mode: low-latency RTP media track + oai-events channel"
                >
                  WebRTC
                </button>
              </div>
              <button
                className="live-ws-toggle-btn"
                onClick={() => setShowWsConfig(!showWsConfig)}
                title="Configure endpoint URL"
              >
                {showWsConfig ? '▲ URL' : '⚙️ URL'}
              </button>
            </>
          )}
        </div>

        {(aiConfig.realtimeEngine === 'websocket' || aiConfig.realtimeEngine === 'openai-realtime' || !aiConfig.realtimeEngine) && showWsConfig && (
          <div className="live-voice-ws-panel">
            <div className="live-voice-ws-input-row">
              <span className="live-ws-icon">🔗</span>
              <input
                type="text"
                className="live-ws-input"
                value={wsUrlInput}
                placeholder={aiConfig.realtimeTransport === 'webrtc' ? 'https://.../v1/realtime/calls' : 'wss://... or ws://localhost:...'}
                onChange={(e) => setWsUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: wsUrlInput.trim() });
                  }
                }}
              />
              <button
                className="live-ws-apply-btn"
                onClick={() => onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: wsUrlInput.trim() })}
              >
                Apply
              </button>
            </div>
            <div className="live-voice-ws-presets">
              <span className="live-ws-preset-label">Presets:</span>
              {aiConfig.realtimeTransport === 'webrtc' ? (
                <>
                  <button
                    type="button"
                    className="live-ws-preset-btn"
                    onClick={() => {
                      const url = 'https://hf-s2s.kumatech.net/v1/realtime/calls';
                      setWsUrlInput(url);
                      onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: url });
                    }}
                  >
                    Kumatech S2S (WebRTC)
                  </button>
                  <button
                    type="button"
                    className="live-ws-preset-btn"
                    onClick={() => {
                      const url = 'http://localhost:8765/v1/realtime/calls';
                      setWsUrlInput(url);
                      onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: url });
                    }}
                  >
                    Localhost (WebRTC)
                  </button>
                  <button
                    type="button"
                    className="live-ws-preset-btn"
                    onClick={() => {
                      const url = 'https://api.openai.com/v1/realtime/calls';
                      setWsUrlInput(url);
                      onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: url });
                    }}
                  >
                    OpenAI Official (WebRTC)
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="live-ws-preset-btn"
                    onClick={() => {
                      const url = 'wss://hf-s2s.kumatech.net/v1/realtime';
                      setWsUrlInput(url);
                      onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: url });
                    }}
                  >
                    Kumatech S2S (WS)
                  </button>
                  <button
                    type="button"
                    className="live-ws-preset-btn"
                    onClick={() => {
                      const url = 'ws://localhost:8765/v1/realtime';
                      setWsUrlInput(url);
                      onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: url });
                    }}
                  >
                    Localhost (ws://)
                  </button>
                  <button
                    type="button"
                    className="live-ws-preset-btn"
                    onClick={() => {
                      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';
                      setWsUrlInput(url);
                      onUpdateAiConfig({ ...aiConfig, realtimeWsUrl: url });
                    }}
                  >
                    OpenAI Official (WS)
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="live-voice-error-banner">
          ⚠️ {errorMessage}
          <button onClick={() => setErrorMessage(null)}>✕</button>
        </div>
      )}

      {/* Center Dynamic Orb Visualizer */}
      <div className="live-voice-center">
        <VoiceOrbVisualizer state={sessionState} audioLevel={audioLevel} size={210} />
        <div className="live-voice-state-caption">
          {sessionState === 'listening' && (
            <span>
              {isMuted ? 'Microphone is muted' : 'Speak naturally — say e.g. "Open chart for MSFT"'}
            </span>
          )}
          {sessionState === 'processing' && <span>Processing your request & tools...</span>}
          {sessionState === 'speaking' && (
            <span>Speaking response (Speak anytime to interrupt)</span>
          )}
          {sessionState === 'interrupted' && <span>Interrupted! Listening to your voice...</span>}
        </div>
      </div>

      {/* Live Conversation Transcript Preview */}
      <div className="live-voice-transcript-area">
        {userTranscript && (
          <div className="live-transcript-bubble user">
            <span className="bubble-label">You</span>
            <div className="bubble-text">{userTranscript}</div>
          </div>
        )}
        {agentResponse && (
          <div className="live-transcript-bubble agent">
            <span className="bubble-label">AI Agent</span>
            <div className="bubble-text">{agentResponse}</div>
          </div>
        )}
      </div>

      {/* Suggested Voice Prompts */}
      <div className="live-voice-suggestions">
        <button
          className="live-suggestion-chip"
          onClick={() => {
            setUserTranscript('Show me NVDA news');
          }}
        >
          "Show me NVDA news"
        </button>
        <button
          className="live-suggestion-chip"
          onClick={() => {
            setUserTranscript('Open chart for MSFT');
          }}
        >
          "Open chart for MSFT"
        </button>
        <button
          className="live-suggestion-chip"
          onClick={() => {
            setUserTranscript('Stage a limit buy for Apple');
          }}
        >
          "Stage a limit buy for Apple"
        </button>
      </div>

      {/* Footer Controls */}
      <div className="live-voice-controls">
        <button
          className={`live-control-btn mute-btn ${isMuted ? 'active' : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? '🔇 Unmute' : '🎙️ Mute'}
        </button>

        <button
          className="live-control-btn interrupt-btn"
          onClick={handleInterrupt}
          disabled={sessionState !== 'speaking' && sessionState !== 'processing'}
          title="Interrupt agent speech"
        >
          ⏹️ Barge-in / Interrupt
        </button>

        <button
          className="live-control-btn text-mode-btn"
          onClick={onSwitchToText}
          title="Switch to text chat mode"
        >
          💬 Text Mode
        </button>

        <button
          className="live-control-btn settings-btn"
          onClick={onOpenSettings}
          title="Configure AI & Voice Settings"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
};
