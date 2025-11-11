import { Chatbar } from './chat/Chatbar';
import './App.css';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <div style={{ flex: '1 1 45%', maxWidth: '45%', borderRight: '1px solid #444', boxSizing: 'border-box', overflow: 'auto', background: '#1f1f1f' }}>
        <Chatbar />
      </div>
      <div style={{ flex: '1 1 55%', minWidth: 0 }}>
        {/* iframe placeholder - replace with url for demos/frontend-app-blotter when it is built */}
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
