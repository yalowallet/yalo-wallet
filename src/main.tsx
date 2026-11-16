
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';

import {
  base,
  mainnet,
  arbitrum,
  optimism,
  polygon
} from 'viem/chains';

import App from './App';
import './style.css';

const appId = 'cmwe424iq004q0gjmcizod4qk';

ReactDOM.createRoot(
  document.getElementById('root')!
).render(
  <React.StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: [
          'email',
          'sms',
          'google',
          'apple'
        ],
        appearance: {
          theme: 'dark',
          accentColor: '#ffe500',
          showWalletLoginFirst: false
        },
        defaultChain: base,
        supportedChains: [
          base,
          mainnet,
          arbitrum,
          optimism,
          polygon
        ],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets'
          },
          solana: {
            createOnLogin: 'users-without-wallets'
          }
        }
      }}
    >
      <App />
    </PrivyProvider>
  </React.StrictMode>
);
