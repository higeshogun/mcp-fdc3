import { useEffect, useRef, useState } from 'react';
// import { isMcpFdc3Resource, handleMcpFdc3Resource } from '../../../../packages/client/dist/mcp-fdc3-client.esm.js';
import { isMcpFdc3Resource, handleMcpFdc3Resource } from '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js';
import type { Interaction } from './types';
import { getStructuredMessage } from './getStructuredMessage';
import type { PoorMansFdc3Agent } from '../fdc3-agent/PoorMansFdc3Agent.js';

const AI_AGENT_ENDPOINT = import.meta.env.VITE_AI_AGENT_ENDPOINT;

interface ChatbarProps {
  fdc3Agent: PoorMansFdc3Agent;
}

//TODO - Clean up this component. On a basic level, it works well enough to demonstrate the concept of MCP-FDC3.
//But it is extremely messy and verbose as it was AI-generated, but without specifying good standards and constraints for the output.
//Same again for the getStructuredMessage() function.
export const Chatbar: React.FC<ChatbarProps> = ({ fdc3Agent }) => {
  const [question, setQuestion] = useState('');
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const resetChat = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    try {
      await fetch(AI_AGENT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      setInteractions([]);
    } catch (e) {
      console.error('Failed to reset chat', e);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const sendQuestion = async (): Promise<void> => {
    console.log('\n\n\n\n%csendQuestion', 'font-weight:bold;');
    const effectiveQuestion = question.trim();
    if (!effectiveQuestion || loading) {
      return;
    }
    console.log('\neffectiveQuestion:');
    console.log(effectiveQuestion);
    console.log('');
    setLoading(true);
    setQuestion('');
    // Placeholder entry to kep ordering consistent (will replace response when returned)
    setInteractions(prev => [...prev, { question: effectiveQuestion, response: '' }]);
    const interactionIndex = interactions.length; // index of the just-added placeholder
    try {
      const res = await fetch(AI_AGENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          question
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        let friendlyErrorMessage: string;
        switch (res.status) {
          case 401:
          case 403:
            friendlyErrorMessage = 'Authentication error when retrieving answer to question. This is most likely caused by an invalid API key in the AI Agent';
            break;
          default:
            friendlyErrorMessage = 'Network error when attempting to retrieve answer to question';
        }
        setInteractions(prev => prev.map((it, i) => i === interactionIndex ? { ...it, isError: true, response: `Error (${res.status}): ${text}`, finalAnswer: friendlyErrorMessage } : it));
      } else {
        const data = await res.json();
        const messages = data?.response?.messages || [];
        const structuredMessage = getStructuredMessage(messages);
        setInteractions(prev => prev.map((it, i) => i === interactionIndex ? { ...it, response: data, finalAnswer: structuredMessage.finalAnswer, mcpResource: structuredMessage.mcpResource } : it));

        console.log('Processing of response from AI Agent is shown below');
        console.log('structuredMessage.mcpResource:');
        console.log(structuredMessage.mcpResource);

        if (isMcpFdc3Resource(structuredMessage.mcpResource)) {
          handleMcpFdc3Resource(fdc3Agent, structuredMessage.mcpResource);
        }

      }
    } catch (e: any) {
      setInteractions(prev => prev.map((it, i) => i === interactionIndex ? { ...it, isError: true, response: `Error (${e.message})`, finalAnswer: 'Error processing response to question' } : it));
      console.error(e);
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

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => setIsListening(true);

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setQuestion(transcript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setQuestion('');
      try {
        recognitionRef.current?.start();
      } catch (e) {
        console.error('Failed to start speech recognition', e);
        setIsListening(false);
      }
    }
  };

  return (
    <div style={{
      margin: '0 auto',
      padding: '0 1rem 1rem',
      background: '#14181f',
      color: '#f5f5f5',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{
        position: 'sticky',
        top: 0,
        background: '#14181f',
        padding: '0.5rem 0 0.75rem',
        zIndex: 20,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '1rem'
      }}>
        <h3 style={{
          margin: 0
        }}>MCP-FDC3 Demo</h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={resetChat}
            disabled={loading}
            style={{
              background: '#21262d',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Reset Chat"
          >
            ↻ Reset
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none', paddingTop: '0.25rem' }}>
            <input
              type="checkbox"
              checked={debugMode}
              onChange={e => setDebugMode(e.target.checked)}
              style={{ cursor: 'pointer ' }}
            />
            Enable debug
          </label>
        </div>
      </div>
      <div style={{
        // paddingBottom: '140px'
      }}>
        <div style={{
          margin: '0 0 1rem',
          padding: '0.75rem',
          background: 'rgba(37, 99, 235, 0.1)',
          border: '1px solid rgba(37, 99, 235, 0.3)',
          borderRadius: '8px',
          fontSize: '0.85rem'
        }}>
          <details open={false}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#93c5fd' }}>
              💡 Available Tools & Interactions (Click to expand)
            </summary>
            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', color: '#bfdbfe' }}>
              <div><strong>Market Data:</strong> <em>"Show me NVDA news", "Get trades for Apple", "What's the AAPL stock price?"</em></div>
              <div><strong>FDC3 Interop:</strong> <em>"Open the chart for MSFT", "Broadcast instrument TSLA"</em></div>
              <div><strong>Voice Input:</strong> Click the microphone icon 🎤 below to speak your command.</div>
              <div><strong>System:</strong> Use the "Reset" button to clear chat history.</div>
            </div>
          </details>
        </div>
        <div style={{
          // paddingBottom: '140px',
          flex: 1,
          overflowY: 'auto'
        }}>
          <div style={{
            // height: '160px'
          }}>
            {interactions.map((it, i) => (
              <div key={i} style={{ marginBottom: '60px' }}>
                <div style={{
                  fontWeight: 500,
                  margin: '0 0 0.5rem',
                  background: 'rgb(30, 41, 59',
                  borderRadius: 16,
                  padding: '1.0rem 1.2rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  textAlign: 'left'
                }}>{it.question}</div>
                {it.finalAnswer && (
                  <div style={{
                    margin: '0 0 30px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '0.75rem 0.75rem',
                    borderRadius: 12,
                    lineHeight: 1.4,
                    textAlign: 'left',
                    color: it.isError ? '#ff4d4f' : undefined,
                  }}>{it.finalAnswer}</div>
                )}
                {/* {it.mcpResource?.uri?.startsWith('fdc3://') && (
                <div style={{ height: 300, width: '100%', margin: '0 0 30px', overflow: 'hidden' }}>
                  {it.mcpResource.uri}
                </div>
              )} */}
                {(debugMode && it.mcpResource) && (
                  <>
                    <div style={{ textAlign: 'left' }}>MCP-FDC3 Resource:</div>
                    <pre style={{
                      margin: '0 0 30px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      color: '#9bd4ff',
                      padding: '0.75rem',
                      borderRadius: 10,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      textAlign: 'left',
                      border: '1pxsolid rgba(255, 255, 255, 0.08'
                    }}>{it.mcpResource ? JSON.stringify(it.mcpResource, undefined, 2) : 'No mcpResource for this interaction'}</pre>
                  </>
                )}
                {debugMode && (
                  <>
                    <div style={{ textAlign: 'left' }}>Full response from AI Agent:</div>
                    <pre style={{
                      background: 'transparent',
                      color: '#ffffff',
                      padding: '0.75rem',
                      borderRadius: 6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      textAlign: 'left',
                      margin: 0,
                      border: '1px solid rgba(0, 0, 0, 0.1)',
                      maxHeight: 350,
                      overflowY: 'auto'
                    }}>{it.response ? JSON.stringify(it.response, undefined, 2) : ''}</pre>
                  </>
                )}
                {loading && <pre style={{ opacity: 0.6 }}>Waiting for response...</pre>}
                <div ref={bottomRef} />
              </div>
            ))}
          </div>
          <div style={{
            position: 'sticky',
            bottom: 0,
            background: '#14181f',
            paddingTop: '0.75rem',
            paddingBottom: '0.5rem',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'flex-end',
            zIndex: 30,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <textarea
              ref={textareaRef}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={'Ask e.g. "Get trades for Apple" or "Show me NVDA news"'}
              style={{ flex: 1, resize: 'none', minHeight: '80px', padding: '0.75rem', fontFamily: 'inherit', background: 'rgb(30, 41, 59)', color: '#f5f5f5', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: 12 }}
            />
            <button
              onClick={toggleListening}
              style={{
                background: isListening ? '#dc2626' : '#374151',
                color: 'white',
                border: 'none',
                padding: '0.75rem',
                borderRadius: '50%',
                width: '48px',
                height: '48px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              title={isListening ? "Stop Listening" : "Start Voice Input"}
            >
              🎤
            </button>
            <button
              onClick={sendQuestion}
              disabled={loading || !question.trim()}
              style={{
                background: '#2563eb',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1rem',
                borderRadius: '20%',
                width: '56px',
                height: '56px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
              title="Send"
            >
              &#9654;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
