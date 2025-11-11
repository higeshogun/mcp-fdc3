import { useState, useEffect, useRef } from 'react';
import './App.css';

const AI_AGENT_ENDPOINT = 'http://localhost:4000/api/chat';

type URI = 'fdc3://api-method-request';

type MimeType = 'application/vnd.mcp-fdc3.fdc3-api-method-request';

interface McpResource {
  uri: URI;
  mimeType: MimeType;
  text: string; // FDC3 message JSON content
  blob?: never;
  _meta?: Record<string, unknown>;
};

interface Interaction {
  question: string;
  response: string;
  finalAnswer?: string;
  mcpResource?: any;
  isError?: boolean;
}

// Extract resource artifact and finl natural language answer from LngChain serialized messages
function extractResult(messages: any[]): { mcpResource?: McpResource, finalAnswer?: string } {
  const result: { finalAnswer?: string, mcpResource?: any } = {};
  for (const msg of messages) {
    const msgType = msg?.id?.[2];
    if (msgType === 'ToolMessage') {
      const artifacts = msg?.kwargs?.artifact;
      if (Array.isArray(artifacts)) {
        for (const art of artifacts) {
          if (art?.type === 'resource' && art.resource && !result.mcpResource) {
            result.mcpResource = art.resource;
            break;
          }
        }
      }
    }
    if (result.mcpResource) {
      break;
    }
  }
  // Find last AIMessage with text content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgType = msg?.id?.[2];
    if (msgType === 'AIMessage') {
      const content = msg?.kwargs?.content;
      if (typeof content === 'string') {
        result.finalAnswer = content.trim();
        break;
      }
      if (Array.isArray(content)) {
        const text = content.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? p?.content ?? ''))).filter(Boolean).join('\n').trim();
        if (text) {
          result.finalAnswer = text;
          break;
        }
      }
    }
  }
  return result;
}

const Chatbar: React.FC = () => {
  const [question, setQuestion] = useState('');
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const sendQuestion = async (): Promise<void> => {
    console.log('sendQuestion');
    const effectiveQuestion = question.trim();
    if (!effectiveQuestion || loading) {
      return;
    }
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
        const extracted = extractResult(messages);
        setInteractions(prev => prev.map((it, i) => i === interactionIndex ? { ...it, response: data, finalAnswer: extracted.finalAnswer, mcpResource: extracted.mcpResource } : it));

        console.log('extracted.mcpResource');
        console.log(extracted.mcpResource);
        if (extracted.mcpResource) {
          console.log(extracted.mcpResource.uri);
          console.log(extracted.mcpResource.mimeType);
          console.log(extracted.mcpResource.text);
          const fdc3Message = JSON.parse(extracted.mcpResource.text);
          console.log('fdc3Message');
          console.log(fdc3Message);
        }
      }
    } catch (e: any) {
      setInteractions(prev => prev.map((it, i) => i === interactionIndex ? { ...it, isError: true, response: `Network error (${e.message})`, finalAnswer: 'Network error' } : it));
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

  return (
    <div style={{
      // maxWidth: 800,
      margin: '0 auto',
      padding: '0 1rem 1rem',
      background: '#14181f',
      color: '#f55f5',
      minHeight: '100dvh',
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
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none', paddingTop: '0.25rem' }}>
          <input
            type="checkbox"
            checked={debugMode}
            onChange={e => setDebugMode(e.target.checked)}
            style={{ cursor: 'pointer '}}
          />
          Enable debug
        </label>
      </div>
      <div style={{
        // paddingBottom: '140px'
      }}>
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
            placeholder='Ask your question e.g. Get trades for microsoft ...'
            style={{ flex: 1, resize: 'none', minHeight: '80px', padding: '0.75rem', fontFamily: 'inherit', background: 'rgb(30, 41, 59)', color: '#f5f5f5', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: 12 }}
          />
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

function App() {

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <div style={{ flex: '1 1 45%', maxWidth: '45%', borderRight: '1px solid #444', boxSizing: 'border-box', overflow: 'auto', background: '#1f1f1f' }}>
        <Chatbar />
      </div>
      <div style={{ flex: '1 1 55%', minWidth: 0 }}>
        <iframe
          src="https://en.wikipedia.org"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            border: "0",
          }}
        ></iframe>
      </div>
    </div>
  );
}

export default App;
