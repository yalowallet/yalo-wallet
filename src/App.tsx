
import { useCallback, useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  isAddress,
  parseEther
} from 'viem';
import { base, mainnet } from 'viem/chains';
import { QRCodeSVG } from 'qrcode.react';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Copy,
  LogOut,
  ShieldCheck,
  Globe,
  CreditCard,
  TrendingUp,
  X
} from 'lucide-react';

type NetworkName = 'base' | 'ethereum';

const networks = {
  base: {
    chain: base,
    name: 'Base',
    symbol: 'ETH',
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org'
  },
  ethereum: {
    chain: mainnet,
    name: 'Ethereum',
    symbol: 'ETH',
    rpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io'
  }
};

export default function App() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();

  const [network, setNetwork] = useState<NetworkName>('base');
  const [balance, setBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [txHash, setTxHash] = useState('');

  const wallet = wallets[0];
  const address = wallet?.address;
  const selectedNetwork = networks[network];

  const loadBalance = useCallback(async () => {
    if (!address) return;

    setRefreshing(true);

    try {
      const client = createPublicClient({
        chain: selectedNetwork.chain,
        transport: http(selectedNetwork.rpc)
      });

      const result = await client.getBalance({
        address: address as `0x${string}`
      });

      setBalance(formatEther(result));
    } catch (error) {
      console.error('BALANCE ERROR:', error);
      setMessage('Unable to load balance. Please try again.');
    } finally {
      setRefreshing(false);
    }
  }, [address, selectedNetwork]);

  useEffect(() => {
    if (authenticated && address) {
      void loadBalance();
    }
  }, [authenticated, address, loadBalance]);

  async function handleSend() {
    setMessage('');
    setTxHash('');

    if (!wallet) {
      setMessage('Wallet not found. Please reconnect.');
      return;
    }

    if (!recipient || !isAddress(recipient)) {
      setMessage('Please enter a valid wallet address.');
      return;
    }

    if (
      !amount ||
      !/^(?:\d+\.?\d*|\.\d+)$/.test(amount) ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      setMessage('Please enter a valid amount.');
      return;
    }

    let value: bigint;

    try {
      value = parseEther(amount);
    } catch {
      setMessage('Invalid ETH amount.');
      return;
    }

    try {
      setLoading(true);

      const chain = selectedNetwork.chain;

      await wallet.switchChain(chain.id);

      const provider = await wallet.getEthereumProvider();

      const walletClient = createWalletClient({
        account: wallet.address as `0x${string}`,
        chain,
        transport: custom(provider)
      });

      const hash = await walletClient.sendTransaction({
        account: wallet.address as `0x${string}`,
        to: recipient as `0x${string}`,
        value
      });

      setTxHash(hash);
      setMessage('Transaction submitted. Waiting for confirmation...');

      const client = createPublicClient({
        chain,
        transport: http(selectedNetwork.rpc)
      });

      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 120000
      });

      if (receipt.status === 'success') {
        setMessage('ETH transfer successful!');
        setRecipient('');
        setAmount('');
        setShowSend(false);
        await loadBalance();
      } else {
        setMessage('Transaction failed on the selected network.');
      }
    } catch (error) {
      console.error('SEND ERROR:', error);

      setMessage(
        error instanceof Error
          ? error.message
          : 'Transaction failed or was cancelled.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyAddress() {
    if (!address) return;

    try {
      await navigator.clipboard.writeText(address);
      setMessage('Wallet address copied.');
    } catch (error) {
      console.error('COPY ERROR:', error);
      setMessage('Unable to copy address. Please copy it manually.');
    }
  }

  if (!ready) {
    return (
      <div className="loading-screen">
        <div className="brand-logo">Y</div>
        <h2>YALO WALLET</h2>
        <p>Loading your wallet...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <div className="brand-logo">Y</div>
          <h1>YALO WALLET</h1>
          <p className="tagline">Your crypto. Your control.</p>

          <div className="security-note">
            <ShieldCheck size={22} />
            <span>Self-custody wallet powered by Privy</span>
          </div>

          <button className="primary-button" onClick={login}>
            Create Wallet / Login
          </button>

          <p className="small-note">
            Secure access to your Ethereum and Base wallet.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="app-container">
      <header className="topbar">
        <div className="brand">
          <div className="brand-small">Y</div>
          <span>YALO <b>WALLET</b></span>
        </div>

        <button className="icon-button" onClick={() => logout()}>
          <LogOut size={19} />
        </button>
      </header>

      <main className="dashboard">
        <div className="welcome-row">
          <div>
            <p className="muted">Welcome back</p>
            <h2>My Wallet</h2>
          </div>

          <div className="network-selector">
            <Globe size={16} />
            <select
              value={network}
              onChange={(e) =>
                setNetwork(e.target.value as NetworkName)
              }
            >
              <option value="base">Base</option>
              <option value="ethereum">Ethereum</option>
            </select>
          </div>
        </div>

        <section className="balance-card">
          <div className="balance-top">
            <span>Total ETH Balance</span>
            <ShieldCheck size={20} />
          </div>

          <h1>
            {Number(balance).toFixed(6)} <small>ETH</small>
          </h1>

          <p className="network-label">
            {selectedNetwork.name} Mainnet
          </p>

          <button
            className="refresh-button"
            onClick={() => void loadBalance()}
            disabled={refreshing}
          >
            <RefreshCw size={15} />
            {refreshing ? 'Refreshing...' : 'Refresh balance'}
          </button>
        </section>

        <section className="action-grid">
          <button onClick={() => setShowSend(true)}>
            <span className="action-icon"><ArrowUpRight /></span>
            <b>Send</b>
          </button>

          <button onClick={() => setShowReceive(true)}>
            <span className="action-icon"><ArrowDownLeft /></span>
            <b>Receive</b>
          </button>

          <button onClick={() => void copyAddress()}>
            <span className="action-icon"><Copy /></span>
            <b>Copy Address</b>
          </button>
        </section>

        <section className="wallet-address">
          <div>
            <p className="muted">Your wallet address</p>
            <p className="address-text">
              {address
                ? `${address.slice(0, 10)}...${address.slice(-8)}`
                : 'Wallet unavailable'}
            </p>
          </div>

          <button
            className="icon-button"
            onClick={() => void copyAddress()}
          >
            <Copy size={18} />
          </button>
        </section>

        {message && (
          <div className="message-box">
            {message}

            {txHash && (
              <a
                href={`${selectedNetwork.explorer}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            )}
          </div>
        )}

        <section className="features-section">
          <h3>Wallet Services</h3>

          <div className="feature-item">
            <div className="feature-icon"><Wallet /></div>
            <div>
              <b>My Assets</b>
              <p>ETH balance on supported networks</p>
            </div>
            <span className="status-active">LIVE</span>
          </div>

          <div className="feature-item">
            <div className="feature-icon"><TrendingUp /></div>
            <div>
              <b>Swap</b>
              <p>Swap provider integration required</p>
            </div>
            <span className="status-setup">SETUP</span>
          </div>

          <div className="feature-item">
            <div className="feature-icon"><ShieldCheck /></div>
            <div>
              <b>Staking & Earn</b>
              <p>Protocol integration required</p>
            </div>
            <span className="status-setup">SETUP</span>
          </div>

          <div className="feature-item">
            <div className="feature-icon"><CreditCard /></div>
            <div>
              <b>YALO Visa Card</b>
              <p>Issuing partner and verification required</p>
            </div>
            <span className="status-setup">SETUP</span>
          </div>
        </section>

        <footer>
          <ShieldCheck size={15} />
          <span>
            Self-custody wallet - Never share your recovery phrase
          </span>
        </footer>

        {showSend && (
          <div className="modal-overlay">
            <div className="modal">
              <button
                className="modal-close"
                onClick={() => setShowSend(false)}
                disabled={loading}
              >
                <X />
              </button>

              <h2>Send ETH</h2>
              <p className="muted">
                Send real ETH on {selectedNetwork.name} Mainnet.
              </p>

              <label>Recipient address</label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x..."
                disabled={loading}
              />

              <label>Amount (ETH)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.01"
                disabled={loading}
              />

              <button
                className="primary-button"
                onClick={() => void handleSend()}
                disabled={loading}
              >
                {loading ? 'Waiting for confirmation...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {showReceive && (
          <div className="modal-overlay">
            <div className="modal receive-modal">
              <button
                className="modal-close"
                onClick={() => setShowReceive(false)}
              >
                <X />
              </button>

              <h2>Receive ETH</h2>
              <p className="muted">
                Send ETH to this address on {selectedNetwork.name} Mainnet.
              </p>

              {address && <QRCodeSVG value={address} size={180} />}

              <div className="receive-address">{address}</div>

              <button
                className="primary-button"
                onClick={() => void copyAddress()}
              >
                <Copy size={17} /> Copy wallet address
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
        }
            
