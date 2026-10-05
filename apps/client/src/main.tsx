import React from 'react';
import { createRoot } from 'react-dom/client';
import { Host } from './Host';
import { Player } from './Player';
import { useGame } from './useGame';
import './styles.css';
import './layout.css';
function App() {
  const role = location.pathname.startsWith('/player') ? 'player' : 'host';
  const game = useGame(role);
  return (
    <>
      <div className={`connection-banner ${game.connected ? 'online' : ''}`}>
        {game.connected ? '' : 'Connection lost · reconnecting automatically…'}
      </div>
      {game.error && (
        <div className="error-toast" role="alert">
          <span>{game.error}</span>
          {game.error.includes('Host key') && (
            <button
              onClick={() => {
                const key = prompt('Host key');
                if (key) {
                  sessionStorage.setItem('midnight-host-key', key);
                  location.reload();
                }
              }}
            >
              Enter key
            </button>
          )}
          <button aria-label="Dismiss error" onClick={() => game.setError('')}>
            ×
          </button>
        </div>
      )}
      {role === 'host' ? <Host game={game} /> : <Player game={game} />}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
