import { useEffect, useRef, useState } from 'react';
import { isMcpFdc3Resource, handleMcpFdc3Resource } from '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js';
import type { Interaction, AIConfig } from './types';
import type { PoorMansFdc3Agent } from '../fdc3-agent/PoorMansFdc3Agent.js';
import { generateUUID } from '../utils/uuid';
import { runBrowserAgent, clearChatSessionHistory } from './browserAgent';
import { AudioRecorder, transcribeAudioWithWhisper, DEFAULT_WHISPER_URL } from './whisperAsr';
import { playTextToSpeech, stopAllSpeech, DEFAULT_TTS_VOICE, DEFAULT_TTS_MODEL } from './ttsEngine';
import { LiveVoiceView } from './realtimeVoice/LiveVoiceView';
import { DEFAULT_OPENAI_REALTIME_WS_URL } from './realtimeVoice/openAiRealtimeClient';
import { DEFAULT_OPENAI_REALTIME_WEBRTC_URL } from './realtimeVoice/openAiWebRtcClient';
import './Chatbar.css';

const CHAT_SESSION_STORAGE_KEY = 'mcp-fdc3-chat-session-id';
const AI_CONFIG_STORAGE_KEY = 'mcp-fdc3-ai-config';

interface ChatbarProps {
  fdc3Agent: PoorMansFdc3Agent;
}

const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'openai',
  baseUrl: 'https://router.huggingface.co/hf-inference/v1',
  apiKey: 'hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  whisperUrl: DEFAULT_WHISPER_URL,
  ttsProvider: 'ttsServer',
  ttsUrl: 'https://tts.kumatech.net/v1/audio/speech',
  ttsApiKey: 'bbd0ace3bc1a400280df2a0d4322e54e783a84a77b974ac89e4c50e1eed8cd8a',
  ttsVoice: DEFAULT_TTS_VOICE,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsAutoPlay: true,
  realtimeEngine: 'websocket',
  realtimeTransport: 'websocket',
  realtimeWsUrl: DEFAULT_OPENAI_REALTIME_WS_URL,
  realtimeApiKey: '',
  geminiApiKey: '',
  geminiVoice: 'Puck',
  geminiModel: 'gemini-2.0-flash-exp',
  vadSensitivity: 1.0,
};

function getChatSessionId(): string {
  const existing = window.sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = generateUUID();
  window.sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, created);
  return created;
}

function getStoredAIConfig(): AIConfig {
  const stored = window.localStorage.getItem(AI_CONFIG_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed) {
        let wsUrl = parsed.realtimeWsUrl || DEFAULT_AI_CONFIG.realtimeWsUrl;
        if (typeof wsUrl === 'string' && wsUrl.includes('/realtime/v1')) {
          wsUrl = wsUrl.replace('/realtime/v1', '/v1/realtime');
        }
        const updated: AIConfig = {
          ...DEFAULT_AI_CONFIG,
          ...parsed,
          ttsApiKey: parsed.ttsApiKey || DEFAULT_AI_CONFIG.ttsApiKey,
          ttsModel: parsed.ttsModel || DEFAULT_AI_CONFIG.ttsModel,
          ttsVoice: parsed.ttsVoice || DEFAULT_AI_CONFIG.ttsVoice,
          realtimeEngine: (parsed.realtimeEngine === 'openai-realtime' ? 'websocket' : parsed.realtimeEngine) || DEFAULT_AI_CONFIG.realtimeEngine,
          realtimeTransport: parsed.realtimeTransport || DEFAULT_AI_CONFIG.realtimeTransport,
          realtimeWsUrl: wsUrl,
          realtimeApiKey: parsed.realtimeApiKey || DEFAULT_AI_CONFIG.realtimeApiKey,
          vadSensitivity: parsed.vadSensitivity ?? DEFAULT_AI_CONFIG.vadSensitivity,
        };
        try {
          window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore storage error
        }
        return updated;
      }
    } catch (e) {
      console.error('Failed to parse stored AI config', e);
    }
  }
  return DEFAULT_AI_CONFIG;
}

export const Chatbar: React.FC<ChatbarProps> = ({ fdc3Agent }) => {
  const [question, setQuestion] = useState('');
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [chatMode, setChatMode] = useState<'text' | 'voice'>('text');
  const [aiConfig, setAiConfig] = useState<AIConfig>(getStoredAIConfig());
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [activeAsrEngine, setActiveAsrEngine] = useState<'whisper' | 'webspeech'>('whisper');
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);

  const recorderRef = useRef<AudioRecorder>(new AudioRecorder());
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(aiConfig));
  }, [aiConfig]);

  const resetChat = (): void => {
    if (loading) return;
    stopAllSpeech();
    setPlayingIndex(null);
    clearChatSessionHistory(getChatSessionId());
    setInteractions([]);
    textareaRef.current?.focus();
  };

  const sendQuestion = async (): Promise<void> => {
    const effectiveQuestion = question.trim();
    if (!effectiveQuestion || loading) {
      return;
    }
    stopAllSpeech();
    setPlayingIndex(null);
    setLoading(true);
    setQuestion('');
    setInteractions(prev => [...prev, { question: effectiveQuestion, response: null }]);
    const interactionIndex = interactions.length;
    try {
      const structuredMessage = await runBrowserAgent(getChatSessionId(), effectiveQuestion, aiConfig);

      setInteractions(prev => prev.map((it, i) => i === interactionIndex ? {
        ...it,
        response: { messages: [structuredMessage] },
        finalAnswer: structuredMessage.finalAnswer,
        mcpResource: structuredMessage.mcpResource
      } : it));

      if (isMcpFdc3Resource(structuredMessage.mcpResource)) {
        handleMcpFdc3Resource(fdc3Agent, structuredMessage.mcpResource);
      }

      // Auto-play TTS reply if enabled
      if (structuredMessage.finalAnswer && aiConfig.ttsAutoPlay && aiConfig.ttsProvider !== 'none') {
        playTextToSpeech(structuredMessage.finalAnswer, aiConfig, (playing) => {
          setPlayingIndex(playing ? interactionIndex : null);
        });
      }
    } catch (e: any) {
      const msg = e?.message || 'Error processing request';
      setInteractions(prev => prev.map((it, i) => i === interactionIndex ? {
        ...it,
        isError: true,
        response: `Error: ${msg}`,
        finalAnswer: msg
      } : it));
      console.error('Chat error:', e);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [interactions, loading]);

  // Initialize WebSpeech fallback
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onstart = () => {
        setIsListening(true);
        setActiveAsrEngine('webspeech');
      };
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setQuestion(transcript);
      };
      recognition.onerror = (event: any) => {
        console.error('WebSpeech recognition error', event.error);
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = async () => {
    if (isTranscribing) return;

    if (isListening) {
      // Stop recording / listening
      if (activeAsrEngine === 'whisper') {
        setIsListening(false);
        setIsTranscribing(true);
        try {
          const audioBlob = await recorderRef.current.stop();
          const whisperUrl = aiConfig.whisperUrl?.trim() || DEFAULT_WHISPER_URL;
          console.log(`[ASR] Transcribing audio with Whisper server: ${whisperUrl}`);
          const transcript = await transcribeAudioWithWhisper(audioBlob, { whisperUrl });
          if (transcript) {
            setQuestion(transcript);
          }
        } catch (whisperErr: any) {
          console.error('[ASR] Whisper transcription failed:', whisperErr);
          alert(`Whisper ASR error: ${whisperErr?.message || 'Failed to transcribe'}. You can check your mic or settings.`);
        } finally {
          setIsTranscribing(false);
        }
      } else {
        recognitionRef.current?.stop();
        setIsListening(false);
      }
    } else {
      // Start recording with Whisper ASR first
      setQuestion('');
      try {
        await recorderRef.current.start();
        setActiveAsrEngine('whisper');
        setIsListening(true);
        console.log('[ASR] Whisper AudioRecorder started.');
        return;
      } catch (whisperStartErr) {
        console.warn('[ASR] Whisper AudioRecorder failed to start, falling back to WebSpeech API:', whisperStartErr);
      }

      // Fallback to WebSpeech API
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
          setActiveAsrEngine('webspeech');
          setIsListening(true);
          console.log('[ASR] Fallback WebSpeech recognition started.');
        } catch (webSpeechErr) {
          console.error('[ASR] Failed to start WebSpeech recognition:', webSpeechErr);
          setIsListening(false);
        }
      } else {
        alert('Microphone access or speech recognition not available in this browser.');
      }
    }
  };

  const toggleSpeechForMessage = (index: number, text: string) => {
    if (playingIndex === index) {
      stopAllSpeech();
      setPlayingIndex(null);
    } else {
      playTextToSpeech(text, aiConfig, (playing) => {
        setPlayingIndex(playing ? index : null);
      });
    }
  };

  return (
    <div className="chatbar-container">
      <header className="chatbar-header">
        <h3>MCP-FDC3 Demo</h3>
        <div className="chatbar-controls">
          <button
            onClick={() => {
              stopAllSpeech();
              setChatMode(prev => prev === 'text' ? 'voice' : 'text');
            }}
            className={`chatbar-mode-btn ${chatMode === 'voice' ? 'active-voice' : ''}`}
            title={chatMode === 'text' ? 'Switch to Live Voice Agent (Realtime)' : 'Switch to Text Chat'}
          >
            {chatMode === 'text' ? '🎙️ Live Voice' : '💬 Text Chat'}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="chatbar-settings-btn"
            title="AI Settings"
          >
            ⚙️ AI Settings
          </button>
          <button
            onClick={resetChat}
            disabled={loading}
            className="chatbar-reset-btn"
            title="Reset Chat"
          >
            ↻ Reset
          </button>
          <label className="chatbar-debug-label">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={e => setDebugMode(e.target.checked)}
            />
            Debug
          </label>
        </div>
      </header>

      <div className="chatbar-content-wrapper">
        {showSettings && (
          <div className="chatbar-settings-panel">
            <h4>AI Configuration</h4>
            <div className="chatbar-form-group">
              <label>Provider</label>
              <select 
                value={aiConfig.provider} 
                onChange={e => {
                  const newProvider = e.target.value as any;
                  const defaultModel = newProvider === 'gemini' ? 'gemini-2.0-flash' : newProvider === 'openai' ? 'gpt-4o' : newProvider === 'ollama' ? 'llama3.2' : aiConfig.model;
                  setAiConfig({ ...aiConfig, provider: newProvider, model: defaultModel });
                }}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
                <option value="custom">Custom (OpenAI Compatible)</option>
              </select>
            </div>
            
            <div className="chatbar-form-group">
              <label>Model</label>
              <input 
                type="text" 
                value={aiConfig.model} 
                placeholder="e.g. gemini-2.0-flash, gpt-4o, llama3.2"
                onChange={e => setAiConfig({ ...aiConfig, model: e.target.value })}
              />
            </div>

            {(aiConfig.provider === 'custom' || aiConfig.provider === 'ollama') && (
              <div className="chatbar-form-group">
                <label>Base URL</label>
                <input 
                  type="text" 
                  value={aiConfig.baseUrl || ''} 
                  placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'http://192.168.x.x:xxxx'}
                  onChange={e => setAiConfig({ ...aiConfig, baseUrl: e.target.value })}
                />
              </div>
            )}

            {aiConfig.provider !== 'ollama' && (
              <div className="chatbar-form-group">
                <label>API Key (Optional if self-hosted)</label>
                <input 
                  type="password" 
                  value={aiConfig.apiKey || ''} 
                  placeholder="sk-..."
                  onChange={e => setAiConfig({ ...aiConfig, apiKey: e.target.value })}
                />
              </div>
            )}

            <div className="chatbar-form-group">
              <label>Whisper ASR Endpoint (Fallback: WebSpeech)</label>
              <input 
                type="text" 
                value={aiConfig.whisperUrl || ''} 
                placeholder="https://whisper.kumatech.net/v1/audio/transcriptions"
                onChange={e => setAiConfig({ ...aiConfig, whisperUrl: e.target.value })}
              />
            </div>

            <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '0.25rem 0' }} />
            <h4>Text-to-Speech (TTS)</h4>

            <div className="chatbar-form-group">
              <label>TTS Engine</label>
              <select
                value={aiConfig.ttsProvider || 'ttsServer'}
                onChange={e => setAiConfig({ ...aiConfig, ttsProvider: e.target.value as any })}
              >
                <option value="ttsServer">TTS Server (https://tts.kumatech.net)</option>
                <option value="browser">Browser SpeechSynthesis</option>
                <option value="none">Disabled</option>
              </select>
            </div>

            {aiConfig.ttsProvider !== 'none' && aiConfig.ttsProvider !== 'browser' && (
              <>
                <div className="chatbar-form-group">
                  <label>TTS Endpoint</label>
                  <input
                    type="text"
                    value={aiConfig.ttsUrl || ''}
                    placeholder="https://tts.kumatech.net/v1/audio/speech"
                    onChange={e => setAiConfig({ ...aiConfig, ttsUrl: e.target.value })}
                  />
                </div>
                <div className="chatbar-form-group">
                  <label>TTS API Key (Optional)</label>
                  <input
                    type="password"
                    value={aiConfig.ttsApiKey || ''}
                    placeholder="Leave blank to use main API key"
                    onChange={e => setAiConfig({ ...aiConfig, ttsApiKey: e.target.value })}
                  />
                </div>
                <div className="chatbar-form-group">
                  <label>TTS Voice</label>
                  <input
                    type="text"
                    value={aiConfig.ttsVoice || 'alloy'}
                    placeholder="alloy, echo, fable, onyx, nova, shimmer"
                    onChange={e => setAiConfig({ ...aiConfig, ttsVoice: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="chatbar-form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="tts-autoplay"
                checked={aiConfig.ttsAutoPlay ?? true}
                onChange={e => setAiConfig({ ...aiConfig, ttsAutoPlay: e.target.checked })}
              />
              <label htmlFor="tts-autoplay" style={{ cursor: 'pointer', margin: 0 }}>
                Auto-read AI replies aloud
              </label>
            </div>

            <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />
            <h4>Realtime Voice Agent (Continuous Open Mic)</h4>

            <div className="chatbar-form-group">
              <label>Voice Agent Engine</label>
              <select
                value={aiConfig.realtimeEngine || 'websocket'}
                onChange={e => setAiConfig({ ...aiConfig, realtimeEngine: e.target.value as any })}
              >
                <option value="websocket">WebSocket Mode (Realtime Audio / S2S)</option>
                <option value="gemini-live">Gemini Live (Google Multimodal Live WebSocket)</option>
                <option value="pipeline">In-Browser Pipeline (Whisper + WebMCP + TTS)</option>
              </select>
            </div>

            {(aiConfig.realtimeEngine === 'websocket' || aiConfig.realtimeEngine === 'openai-realtime') && (
              <>
                <div className="chatbar-form-group">
                  <label>Transport Protocol</label>
                  <select
                    value={aiConfig.realtimeTransport || 'websocket'}
                    onChange={e => {
                      const transport = e.target.value as 'websocket' | 'webrtc';
                      let newUrl = aiConfig.realtimeWsUrl;
                      if (transport === 'webrtc' && (!newUrl || newUrl === DEFAULT_OPENAI_REALTIME_WS_URL || newUrl.includes('hf-s2s.kumatech.net'))) {
                        newUrl = DEFAULT_OPENAI_REALTIME_WEBRTC_URL;
                      } else if (transport === 'websocket' && (!newUrl || newUrl === DEFAULT_OPENAI_REALTIME_WEBRTC_URL || newUrl.includes('hf-s2s.kumatech.net'))) {
                        newUrl = DEFAULT_OPENAI_REALTIME_WS_URL;
                      }
                      setAiConfig({ ...aiConfig, realtimeTransport: transport, realtimeWsUrl: newUrl });
                    }}
                  >
                    <option value="websocket">WebSocket (Base64 PCM Streaming)</option>
                    <option value="webrtc">WebRTC (Direct RTP Media Track + DataChannel)</option>
                  </select>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    {aiConfig.realtimeTransport === 'webrtc'
                      ? 'Direct RTP Opus audio track with "oai-events" data channel (SDP offer/answer via HTTP POST).'
                      : 'Full-duplex base64 PCM16 audio chunks streamed over WebSocket.'}
                  </div>
                </div>

                <div className="chatbar-form-group">
                  <label>{aiConfig.realtimeTransport === 'webrtc' ? 'Realtime WebRTC Endpoint (Calls URL)' : 'Realtime WebSocket URL'}</label>
                  <input
                    type="text"
                    value={aiConfig.realtimeWsUrl || (aiConfig.realtimeTransport === 'webrtc' ? DEFAULT_OPENAI_REALTIME_WEBRTC_URL : DEFAULT_OPENAI_REALTIME_WS_URL)}
                    placeholder={aiConfig.realtimeTransport === 'webrtc' ? 'https://hf-s2s.kumatech.net/v1/realtime/calls' : 'wss://hf-s2s.kumatech.net/v1/realtime'}
                    onChange={e => setAiConfig({ ...aiConfig, realtimeWsUrl: e.target.value })}
                  />
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    {aiConfig.realtimeTransport === 'webrtc' ? (
                      <>
                        <button
                          type="button"
                          style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#93c5fd', cursor: 'pointer' }}
                          onClick={() => setAiConfig({ ...aiConfig, realtimeWsUrl: 'https://hf-s2s.kumatech.net/v1/realtime/calls' })}
                        >
                          Kumatech S2S (WebRTC)
                        </button>
                        <button
                          type="button"
                          style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#93c5fd', cursor: 'pointer' }}
                          onClick={() => setAiConfig({ ...aiConfig, realtimeWsUrl: 'http://localhost:8765/v1/realtime/calls' })}
                        >
                          Localhost (WebRTC)
                        </button>
                        <button
                          type="button"
                          style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#93c5fd', cursor: 'pointer' }}
                          onClick={() => setAiConfig({ ...aiConfig, realtimeWsUrl: 'https://api.openai.com/v1/realtime/calls' })}
                        >
                          OpenAI Official (WebRTC)
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#93c5fd', cursor: 'pointer' }}
                          onClick={() => setAiConfig({ ...aiConfig, realtimeWsUrl: 'wss://hf-s2s.kumatech.net/v1/realtime' })}
                        >
                          Kumatech S2S (WS)
                        </button>
                        <button
                          type="button"
                          style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#93c5fd', cursor: 'pointer' }}
                          onClick={() => setAiConfig({ ...aiConfig, realtimeWsUrl: 'ws://localhost:8765/v1/realtime' })}
                        >
                          Localhost (ws://)
                        </button>
                        <button
                          type="button"
                          style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', color: '#93c5fd', cursor: 'pointer' }}
                          onClick={() => setAiConfig({ ...aiConfig, realtimeWsUrl: 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview' })}
                        >
                          OpenAI Official (WS)
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="chatbar-form-group">
                  <label>API Key (Optional)</label>
                  <input
                    type="password"
                    value={aiConfig.realtimeApiKey || ''}
                    placeholder="Leave blank if unauthenticated"
                    onChange={e => setAiConfig({ ...aiConfig, realtimeApiKey: e.target.value })}
                  />
                </div>
              </>
            )}

            {aiConfig.realtimeEngine === 'gemini-live' && (
              <>
                <div className="chatbar-form-group">
                  <label>Google Gemini API Key</label>
                  <input
                    type="password"
                    value={aiConfig.geminiApiKey || aiConfig.apiKey || ''}
                    placeholder="AIzaSy..."
                    onChange={e => setAiConfig({ ...aiConfig, geminiApiKey: e.target.value })}
                  />
                  <small style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', marginTop: '3px' }}>
                    Get an API key from <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>Google AI Studio</a>.
                  </small>
                </div>
                <div className="chatbar-form-group">
                  <label>Gemini Live Model ID</label>
                  <input
                    type="text"
                    value={aiConfig.geminiModel || 'gemini-2.0-flash-exp'}
                    placeholder="gemini-2.0-flash-exp, gemini-3.5-flash, etc."
                    onChange={e => setAiConfig({ ...aiConfig, geminiModel: e.target.value })}
                  />
                  <small style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', marginTop: '3px' }}>
                    Specify model name (e.g. <code>gemini-2.0-flash-exp</code>, <code>gemini-3.5-flash</code>).
                  </small>
                </div>
                <div className="chatbar-form-group">
                  <label>Gemini Voice</label>
                  <select
                    value={aiConfig.geminiVoice || 'Puck'}
                    onChange={e => setAiConfig({ ...aiConfig, geminiVoice: e.target.value as any })}
                  >
                    <option value="Puck">Puck (Natural / Balanced)</option>
                    <option value="Aoede">Aoede (Expressive / Warm)</option>
                    <option value="Charon">Charon (Deep / Authoritative)</option>
                    <option value="Fenrir">Fenrir (Clear / Direct)</option>
                    <option value="Kore">Kore (Soft / Friendly)</option>
                  </select>
                </div>
              </>
            )}

            {aiConfig.realtimeEngine !== 'pipeline' && (
              <div className="chatbar-form-group">
                <label>System Prompt / Agent Definition</label>
                <textarea
                  rows={4}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '4px',
                    color: '#fff',
                    fontSize: '0.8rem',
                    padding: '6px',
                    resize: 'vertical',
                  }}
                  value={
                    aiConfig.systemPrompt !== undefined
                      ? aiConfig.systemPrompt
                      : 'You are an intelligent financial voice assistant demonstrating an FDC3 interop desktop application. You have access to real-time tools for retrieving trades (getTrades), viewing/filtering news by ticker, topic, or bullish/bearish sentiment (getNews), interactive charting with durations like 1D, 1W, 1M, 3M, 1Y and styles (viewChart), adding/removing watchlist instruments (addToWatchlist, removeFromWatchlist), submitting and executing orders by voice (submitOrder), staging and preparing orders in the order ticket for review without executing (stageOrder), cancelling active/pending orders on the blotter (cancelOrder), retrieving current positions and exposure (getPositions), checking account balance, equity, and P&L (getAccountSummary), requesting quotes (requestQuote), and resetting desktop filters (clearFilters). When the user asks about trades, news, charts, quotes, submitting, staging, or cancelling orders, positions, account balance, watchlist changes, or filter resets, always invoke the appropriate tool. Answer conversationally, accurately, and concisely.'
                  }
                  placeholder="Customize the voice assistant instructions and persona..."
                  onChange={e => setAiConfig({ ...aiConfig, systemPrompt: e.target.value })}
                />
              </div>
            )}

            <div className="chatbar-form-group">
              <label>Mic VAD Sensitivity (Lower = easier speech trigger)</label>
              <input
                type="number"
                step="0.1"
                min="0.4"
                max="3.0"
                value={aiConfig.vadSensitivity ?? 1.0}
                onChange={e => setAiConfig({ ...aiConfig, vadSensitivity: parseFloat(e.target.value) || 1.0 })}
              />
            </div>

            <button 
              className="chatbar-reset-btn" 
              style={{ alignSelf: 'flex-end', marginTop: '0.5rem' }}
              onClick={() => setShowSettings(false)}
            >
              Close
            </button>
          </div>
        )}

        {chatMode === 'voice' ? (
          <LiveVoiceView
            sessionId={getChatSessionId()}
            fdc3Agent={fdc3Agent}
            aiConfig={aiConfig}
            onUpdateAiConfig={setAiConfig}
            onSwitchToText={() => setChatMode('text')}
            onOpenSettings={() => setShowSettings(true)}
            onInteractionAdded={(interaction) => setInteractions(prev => [...prev, interaction])}
          />
        ) : (
          <>
            <div className="chatbar-info-box">
              <details>
                <summary className="chatbar-info-summary">
                  💡 Available Tools & Interactions
                </summary>
                <div className="chatbar-info-details">
                  <div><strong>Market Data:</strong> <em>"Show me NVDA news", "Get trades for Apple"</em></div>
                  <div><strong>FDC3 Interop:</strong> <em>"Open chart for MSFT", "Broadcast TSLA"</em></div>
                  <div><strong>Voice Input:</strong> Click 🎤 to speak (Whisper ASR / WebSpeech fallback).</div>
                  <div><strong>Speech Output:</strong> Responses spoken via TTS (Server / Browser fallback).</div>
                </div>
              </details>
            </div>

            <div className="chatbar-messages-container">
              {interactions.map((it, i) => (
                <div key={i} className="chatbar-interaction">
                  <div className="chatbar-question">{it.question}</div>
                  {it.finalAnswer && (
                    <div className={`chatbar-answer ${it.isError ? 'error' : ''}`}>
                      <div className="chatbar-answer-header">
                        <span className="chatbar-answer-text">{it.finalAnswer}</span>
                        <button
                          onClick={() => toggleSpeechForMessage(i, it.finalAnswer!)}
                          className={`chatbar-speaker-btn ${playingIndex === i ? 'playing' : ''}`}
                          title={playingIndex === i ? "Stop speaking" : "Listen to reply"}
                        >
                          {playingIndex === i ? '⏹️' : '🔊'}
                        </button>
                      </div>
                    </div>
                  )}
                  {debugMode && it.mcpResource && (
                    <div className="chatbar-debug-block">
                      <div>MCP-FDC3 Resource:</div>
                      <pre className="chatbar-debug-pre">{JSON.stringify(it.mcpResource, null, 2)}</pre>
                    </div>
                  )}
                  {debugMode && it.response && (
                    <div className="chatbar-debug-block">
                      <div>Full AI Agent Response:</div>
                      <pre className="chatbar-debug-pre">{JSON.stringify(it.response, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
              {loading && <div style={{ opacity: 0.6, padding: '1rem 0' }}>Waiting for response...</div>}
              <div ref={bottomRef} />
            </div>

            <footer className="chatbar-footer">
              <div className="chatbar-suggestions">
                {[
                  "Get trades for Apple",
                  "Show me NVDA news",
                  "Stage a limit buy for 100 MSFT at $412"
                ].map((text, idx) => (
                  <button
                    key={idx}
                    onClick={() => setQuestion(text)}
                    className="chatbar-suggestion-btn"
                  >
                    {text}
                  </button>
                ))}
              </div>
              <div className="chatbar-input-row">
                <textarea
                  ref={textareaRef}
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isListening
                      ? activeAsrEngine === 'whisper'
                        ? '🎙️ Recording audio (Whisper)... click mic to transcribe'
                        : '🎙️ Listening (WebSpeech)... speak into mic'
                      : isTranscribing
                      ? '⏳ Transcribing with Whisper ASR...'
                      : 'Ask e.g. "Get trades for Apple"'
                  }
                  className="chatbar-textarea"
                />
                <button
                  onClick={toggleListening}
                  disabled={isTranscribing}
                  className={`chatbar-icon-btn ${isListening ? 'listening' : ''} ${isTranscribing ? 'transcribing' : ''}`}
                  title={
                    isTranscribing
                      ? "Transcribing audio..."
                      : isListening
                      ? "Stop recording & transcribe"
                      : "Start Voice Input (Whisper ASR)"
                  }
                >
                  {isTranscribing ? '⏳' : '🎤'}
                </button>
                <button
                  onClick={sendQuestion}
                  disabled={loading || isTranscribing || !question.trim()}
                  className="chatbar-send-btn"
                  title="Send"
                >
                  &#9654;
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};
