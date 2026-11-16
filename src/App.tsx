
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  usePrivy,
  useWallets,
  useSendTransaction
} from '@privy-io/react-auth';

import {
  useSignAndSendTransaction,
  useWallets as useSolanaWallets
} from '@privy-io/react-auth/solana';

import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseEther,
  parseUnits,
  erc20Abi
} from 'viem';

import {
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon
} from 'viem/chains';

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction
} from '@solana/web3.js';

import {
  getAssociatedTokenAddress,
  createTransferInstruction
} from '@solana/spl-token';

import { QRCodeSVG } from 'qrcode.react';

import {
  Wallet,
  LogOut,
  Copy,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Send,
  Menu,
  X,
  ChevronDown,
  ExternalLink,
  History,
  Settings,
  Coins,
  ShieldCheck,
  Check,
  AlertCircle,
  Globe,
  Eye,
  EyeOff,
  Plus,
  Search,
  ArrowLeft,
  CheckCircle,
  Clock,
  WalletCards
} from 'lucide-react';

type NetworkKey =
  | 'base'
  | 'ethereum'
  | 'arbitrum'
  | 'optimism'
  | 'polygon'
  | 'solana'
  | 'tron';

type Token = {
  symbol: string;
  name: string;
  address?: string;
  decimals: number;
  balance: string;
};

type Activity = {
  hash: string;
  type: 'Send' | 'Receive';
  amount: string;
  symbol: string;
  date: string;
  network: string;
};

type EvmNetwork = {
  name: string;
  chain: typeof base;
  rpc: string;
  explorer: string;
};

const EVM_NETWORKS = {
  base: {
    name: 'Base',
    chain: base,
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org/tx/'
  },
  ethereum: {
    name: 'Ethereum',
    chain: mainnet,
    rpc: 'https://cloudflare-eth.com',
    explorer: 'https://etherscan.io/tx/'
  },
  arbitrum: {
    name: 'Arbitrum',
    chain: arbitrum,
    rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io/tx/'
  },
  optimism: {
    name: 'Optimism',
    chain: optimism,
    rpc: 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io/tx/'
  },
  polygon: {
    name: 'Polygon',
    chain: polygon,
    rpc: 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com/tx/'
  }
};

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

declare global {
  interface Window {
    tronWeb?: any;
  }
}

function shortAddress(address?: string) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-5)}`;
}

function getError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}

function isValidAmount(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

export default function App() {
  const {
    ready,
    authenticated,
    login,
    logout,
    user
  } = usePrivy();

  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  const { wallets: solanaWallets } = useSolanaWallets();

  const { signAndSendTransaction } =
    useSignAndSendTransaction();

  const [network, setNetwork] =
    useState<NetworkKey>('base');

  const [activeTab, setActiveTab] =
    useState('Overview');

  const [menuOpen, setMenuOpen] =
    useState(false);

  const [showBalance, setShowBalance] =
    useState(true);

  const [balance, setBalance] =
    useState('0.000000');

  const [tokens, setTokens] =
    useState<Token[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [modal, setModal] =
    useState<'send' | 'receive' | 'token' | null>(null);

  const [recipient, setRecipient] =
    useState('');

  const [amount, setAmount] =
    useState('');

  const [tokenAddress, setTokenAddress] =
    useState('');

  const [tokenAmount, setTokenAmount] =
    useState('');

  const [selectedToken, setSelectedToken] =
    useState<Token | null>(null);

  const [message, setMessage] =
    useState('');

  const [error, setError] =
    useState('');

  const [activities, setActivities] =
    useState<Activity[]>([]);

  const [tronAddress, setTronAddress] =
    useState('');

  const [tronConnected, setTronConnected] =
    useState(false);

  const evmWallet =
    wallets.find(wallet => wallet.walletClientType === 'privy') ||
    wallets[0];

  const evmAddress = evmWallet?.address || '';

  const solWallet = solanaWallets[0];

  const solAddress = solWallet?.address || '';

  const isEvm = network in EVM_NETWORKS;

  const currentAddress = useMemo(() => {
    if (network === 'solana') return solAddress;
    if (network === 'tron') return tronAddress;
    return evmAddress;
  }, [
    network,
    solAddress,
    tronAddress,
    evmAddress
  ]);

  const publicClient = useMemo(() => {
    if (!isEvm) return null;

    const config =
      EVM_NETWORKS[network as keyof typeof EVM_NETWORKS];

    return createPublicClient({
      chain: config.chain,
      transport: http(config.rpc)
    });
  }, [network, isEvm]);

  const addActivity = useCallback(
    (activity: Activity) => {
      setActivities(previous =>
        [activity, ...previous].slice(0, 50)
      );
    },
    []
  );

  const showSuccess = useCallback((text: string) => {
    setMessage(text);
    setError('');
  }, []);

  const showError = useCallback((text: string) => {
    setError(text);
    setMessage('');
  }, []);
    
  const refreshBalance = useCallback(async () => {
    if (!authenticated) return;

    setRefreshing(true);
    setError('');

    try {
      if (network === 'solana') {
        if (!solAddress) {
          setBalance('0');
          setTokens([]);
          return;
        }

        const connection = new Connection(SOLANA_RPC);
        const publicKey = new PublicKey(solAddress);

        const lamports =
          await connection.getBalance(publicKey);

        setBalance((lamports / 1e9).toFixed(6));

        const tokenAccounts =
          await connection.getParsedTokenAccountsByOwner(
            publicKey,
            { programId: new PublicKey(
              'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
            )}
          );

        const solTokens: Token[] =
          tokenAccounts.value.map(account => {
            const info =
              account.account.data.parsed.info;

            return {
              symbol: info.mint.slice(0, 5),
              name: 'Solana Token',
              address: info.mint,
              decimals: info.tokenAmount.decimals,
              balance: info.tokenAmount.uiAmountString || '0'
            };
          });

        setTokens(solTokens);
        return;
      }

      if (network === 'tron') {
        const tron = window.tronWeb;

        if (!tron || !tron.defaultAddress?.base58) {
          setTronConnected(false);
          setTronAddress('');
          setBalance('0');
          setTokens([]);
          return;
        }

        const address = tron.defaultAddress.base58;

        setTronConnected(true);
        setTronAddress(address);

        const sun = await tron.trx.getBalance(address);

        setBalance((sun / 1e6).toFixed(6));
        setTokens([]);
        return;
      }

      if (publicClient && evmAddress) {
        const rawBalance =
          await publicClient.getBalance({
            address: evmAddress as `0x${string}`
          });

        setBalance(formatEther(rawBalance));
        setTokens([]);
      }
    } catch (err) {
      showError(getError(err));
    } finally {
      setRefreshing(false);
    }
  }, [
    authenticated,
    network,
    solAddress,
    evmAddress,
    publicClient,
    showError
  ]);

  useEffect(() => {
    if (authenticated) {
      void refreshBalance();
    }
  }, [authenticated, refreshBalance]);

  useEffect(() => {
    if (network === 'tron') {
      const tron = window.tronWeb;

      if (tron?.defaultAddress?.base58) {
        setTronConnected(true);
        setTronAddress(tron.defaultAddress.base58);
      } else {
        setTronConnected(false);
        setTronAddress('');
      }
    }
  }, [network]);

  const connectTron = useCallback(async () => {
    try {
      if (!window.tronWeb) {
        showError(
          'TronLink is not detected. Open YALO Wallet inside the TronLink browser.'
        );
        return;
      }

      const tron = window.tronWeb;

      if (!tron.defaultAddress?.base58) {
        showError(
          'Please unlock your TronLink wallet first.'
        );
        return;
      }

      setTronAddress(tron.defaultAddress.base58);
      setTronConnected(true);
      showSuccess('Tron wallet connected.');
    } catch (err) {
      showError(getError(err));
    }
  }, [showError, showSuccess]);

  const copyAddress = useCallback(async () => {
    if (!currentAddress) {
      showError('No wallet address available.');
      return;
    }

    try {
      await navigator.clipboard.writeText(currentAddress);
      showSuccess('Wallet address copied.');
    } catch {
      showError('Could not copy address.');
    }
  }, [currentAddress, showError, showSuccess]);

  const sendEvmNative = useCallback(async () => {
    if (!evmWallet || !evmAddress) {
      showError('EVM wallet is not connected.');
      return;
    }

    if (!isAddress(recipient)) {
      showError('Enter a valid EVM recipient address.');
      return;
    }

    if (!isValidAmount(amount)) {
      showError('Enter a valid amount.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setMessage('');

      const config =
        EVM_NETWORKS[network as keyof typeof EVM_NETWORKS];

      const tx = await sendTransaction(
        {
          to: recipient as `0x${string}`,
          value: parseEther(amount),
          chainId: config.chain.id
        },
        {
          address: evmAddress
        }
      );

      addActivity({
        hash: tx.hash,
        type: 'Send',
        amount,
        symbol: config.chain.nativeCurrency.symbol,
        date: new Date().toISOString(),
        network: config.name
      });

      setAmount('');
      setRecipient('');
      setModal(null);
      showSuccess('Transaction submitted successfully.');

      void refreshBalance();
    } catch (err) {
      showError(getError(err));
    } finally {
      setLoading(false);
    }
  }, [
    evmWallet,
    evmAddress,
    recipient,
    amount,
    network,
    sendTransaction,
    addActivity,
    showError,
    showSuccess,
    refreshBalance
  ]);

  const sendEvmToken = useCallback(async () => {
    if (!publicClient || !evmAddress || !selectedToken?.address) {
      showError('Select a valid token first.');
      return;
    }

    if (!isAddress(recipient)) {
      showError('Enter a valid recipient address.');
      return;
    }

    if (!isValidAmount(amount)) {
      showError('Enter a valid amount.');
      return;
    }

    if (!isAddress(selectedToken.address)) {
      showError('Invalid token contract address.');
      return;
    }

    try {
      setLoading(true);

      const config =
        EVM_NETWORKS[network as keyof typeof EVM_NETWORKS];

      const tx = await sendTransaction(
        {
          to: selectedToken.address as `0x${string}`,
          data: (
            `0xa9059cbb` +
            recipient.slice(2).toLowerCase().padStart(64, '0') +
            BigInt(
              parseUnits(amount, selectedToken.decimals)
            ).toString(16).padStart(64, '0')
          ) as `0x${string}`,
          value: 0n,
          chainId: config.chain.id
        },
        {
          address: evmAddress
        }
      );

      addActivity({
        hash: tx.hash,
        type: 'Send',
        amount,
        symbol: selectedToken.symbol,
        date: new Date().toISOString(),
        network: config.name
      });

      setAmount('');
      setRecipient('');
      setSelectedToken(null);
      setModal(null);
      showSuccess('Token transfer submitted.');

      void refreshBalance();
    } catch (err) {
      showError(getError(err));
    } finally {
      setLoading(false);
    }
  }, [
    publicClient,
    evmAddress,
    selectedToken,
    recipient,
    amount,
    network,
    sendTransaction,
    addActivity,
    showError,
    showSuccess,
    refreshBalance
  ]);

  const sendSol = useCallback(async () => {
    if (!solWallet || !solAddress) {
      showError('Solana wallet is not connected.');
      return;
    }

    try {
      if (!isValidAmount(amount)) {
        showError('Enter a valid SOL amount.');
        return;
      }

      const destination = new PublicKey(recipient);
      const sender = new PublicKey(solAddress);

      setLoading(true);

      const connection = new Connection(SOLANA_RPC);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: destination,
          lamports: Math.round(Number(amount) * 1e9)
        })
      );

      transaction.feePayer = sender;

      const latest =
        await connection.getLatestBlockhash();

      transaction.recentBlockhash =
        latest.blockhash;

      const serialized =
        transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false
        });

      const result = await signAndSendTransaction({
        transaction: serialized,
        wallet: solWallet
      });

      const signature =
        typeof result === 'string'
          ? result
          : result.signature;

      addActivity({
        hash: signature,
        type: 'Send',
        amount,
        symbol: 'SOL',
        date: new Date().toISOString(),
        network: 'Solana'
      });

      setAmount('');
      setRecipient('');
      setModal(null);
      showSuccess('SOL transfer submitted.');

      void refreshBalance();
    } catch (err) {
      showError(getError(err));
    } finally {
      setLoading(false);
    }
  }, [
    solWallet,
    solAddress,
    amount,
    recipient,
    signAndSendTransaction,
    addActivity,
    showError,
    showSuccess,
    refreshBalance
  ]);

  const sendTron = useCallback(async () => {
    const tron = window.tronWeb;

    if (!tron || !tron.defaultAddress?.base58) {
      showError('Connect your TronLink wallet first.');
      return;
    }

    if (!tron.isAddress(recipient)) {
      showError('Enter a valid TRON address.');
      return;
    }

    if (!isValidAmount(amount)) {
      showError('Enter a valid TRX amount.');
      return;
    }

    try {
      setLoading(true);

      const sun = Math.round(Number(amount) * 1e6);

      const result =
        await tron.trx.sendTransaction(recipient, sun);

      const hash = result.txid || '';

      addActivity({
        hash,
        type: 'Send',
        amount,
        symbol: 'TRX',
        date: new Date().toISOString(),
        network: 'TRON'
      });

      setAmount('');
      setRecipient('');
      setModal(null);
      showSuccess('TRX transfer submitted.');

      void refreshBalance();
    } catch (err) {
      showError(getError(err));
    } finally {
      setLoading(false);
    }
  }, [
    recipient,
    amount,
    addActivity,
    showError,
    showSuccess,
    refreshBalance
  ]);

  const handleSend = useCallback(async () => {
    if (network === 'solana') {
      await sendSol();
      return;
    }

    if (network === 'tron') {
      await sendTron();
      return;
    }

    if (selectedToken) {
      await sendEvmToken();
      return;
    }

    await sendEvmNative();
  }, [
    network,
    selectedToken,
    sendSol,
    sendTron,
    sendEvmToken,
    sendEvmNative
  ]);

  const getExplorerUrl = useCallback(
    (hash: string, activityNetwork?: string) => {
      const target = activityNetwork || network;

      if (target === 'Solana') {
        return `https://solscan.io/tx/${hash}`;
      }

      if (target === 'TRON') {
        return `https://tronscan.org/#/transaction/${hash}`;
      }

      const key =
        target.toLowerCase() as keyof typeof EVM_NETWORKS;

      return EVM_NETWORKS[key]?.explorer + hash || '#';
    },
    [network]
  );

  const nativeSymbol = useMemo(() => {
    if (network === 'solana') return 'SOL';
    if (network === 'tron') return 'TRX';

    return EVM_NETWORKS[
      network as keyof typeof EVM_NETWORKS
    ].chain.nativeCurrency.symbol;
  }, [network]);

  const networkName = useMemo(() => {
    if (network === 'solana') return 'Solana';
    if (network === 'tron') return 'TRON';

    return EVM_NETWORKS[
      network as keyof typeof EVM_NETWORKS
    ].name;
  }, [network]);
            
  if (!ready) {
    return (
      <div className="yalo-loading">
        <div className="yalo-loader" />
        <h2>YALO</h2>
        <p>Preparing your wallet...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <main className="yalo-login">
        <div className="login-card">
          <div className="yalo-logo">Y</div>
          <h1>Welcome to YALO</h1>
          <p>Your wallet. Your assets. Your control.</p>

          <div className="login-features">
            <div>
              <ShieldCheck size={20} />
              <span>Secure wallet access</span>
            </div>
            <div>
              <Globe size={20} />
              <span>Multiple blockchain networks</span>
            </div>
            <div>
              <Wallet size={20} />
              <span>Manage your crypto assets</span>
            </div>
          </div>

          <button
            className="primary-button login-button"
            onClick={login}
          >
            <Wallet size={18} />
            Connect Wallet
          </button>

          <p className="login-note">
            Powered by Privy
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="yalo-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">Y</div>
          <span>YALO</span>
        </div>

        <div className="topbar-right">
          <button
            className="icon-button"
            onClick={() => setShowBalance(!showBalance)}
            title="Toggle balance visibility"
          >
            {showBalance ? <Eye size={19} /> : <EyeOff size={19} />}
          </button>

          <button
            className="wallet-address"
            onClick={copyAddress}
          >
            <Wallet size={16} />
            {shortAddress(currentAddress)}
            <Copy size={14} />
          </button>

          <button
            className="icon-button mobile-menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <div className="app-layout">
        <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
          <div className="sidebar-user">
            <div className="user-avatar">
              <Wallet size={21} />
            </div>
            <div>
              <strong>My Wallet</strong>
              <small>{shortAddress(currentAddress)}</small>
            </div>
          </div>

          <nav className="navigation">
            <button
              className={activeTab === 'Overview' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setActiveTab('Overview');
                setMenuOpen(false);
              }}
            >
              <Wallet size={18} />
              Overview
            </button>

            <button
              className={activeTab === 'Tokens' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setActiveTab('Tokens');
                setMenuOpen(false);
              }}
            >
              <Coins size={18} />
              Tokens
            </button>

            <button
              className={activeTab === 'Activity' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setActiveTab('Activity');
                setMenuOpen(false);
              }}
            >
              <History size={18} />
              Activity
            </button>

            <button
              className={activeTab === 'Settings' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setActiveTab('Settings');
                setMenuOpen(false);
              }}
            >
              <Settings size={18} />
              Settings
            </button>
          </nav>

          <div className="sidebar-bottom">
            <div className="security-label">
              <ShieldCheck size={17} />
              <span>Wallet connected</span>
            </div>

            <button
              className="logout-button"
              onClick={logout}
            >
              <LogOut size={17} />
              Disconnect
            </button>
          </div>
        </aside>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <h1>
                {activeTab === 'Overview' && 'Wallet Overview'}
                {activeTab === 'Tokens' && 'Your Tokens'}
                {activeTab === 'Activity' && 'Transaction Activity'}
                {activeTab === 'Settings' && 'Wallet Settings'}
              </h1>

              <p>
                Manage your digital assets with YALO.
              </p>
            </div>

            <button
              className="network-selector"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Globe size={17} />
              {networkName}
              <ChevronDown size={16} />
            </button>
          </div>

          <section className="network-panel">
            <div className="network-panel-heading">
              <span>SELECT NETWORK</span>
              <span className="network-status">
                <span className="status-dot" />
                Network selection
              </span>
            </div>

            <div className="network-list">
              {(
                [
                  ['base', 'Base'],
                  ['ethereum', 'Ethereum'],
                  ['arbitrum', 'Arbitrum'],
                  ['optimism', 'Optimism'],
                  ['polygon', 'Polygon'],
                  ['solana', 'Solana'],
                  ['tron', 'TRON']
                ] as [NetworkKey, string][]
              ).map(([key, name]) => (
                <button
                  key={key}
                  className={
                    network === key
                      ? 'network-chip selected'
                      : 'network-chip'
                  }
                  onClick={() => {
                    setNetwork(key);
                    setSelectedToken(null);
                    setAmount('');
                    setRecipient('');
                    setError('');
                    setMessage('');
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </section>

          {message && (
            <div className="alert success-alert">
              <CheckCircle size={18} />
              {message}
              <button onClick={() => setMessage('')}>
                <X size={16} />
              </button>
            </div>
          )}

          {error && (
            <div className="alert error-alert">
              <AlertCircle size={18} />
              {error}
              <button onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}

          {activeTab === 'Overview' && (
            <>
              <section className="balance-card">
                <div className="balance-card-top">
                  <span>Total {nativeSymbol} Balance</span>
                  <button
                    className="refresh-button"
                    onClick={() => void refreshBalance()}
                    disabled={refreshing}
                  >
                    <RefreshCw
                      size={17}
                      className={refreshing ? 'spin' : ''}
                    />
                    Refresh
                  </button>
                </div>

                <div className="balance-value">
                  {showBalance ? balance : '••••••••'}
                  <span>{nativeSymbol}</span>
                </div>

                <p className="balance-caption">
                  {networkName} network
                </p>

                <div className="balance-actions">
                  <button
                    className="primary-button"
                    onClick={() => setModal('send')}
                  >
                    <ArrowUpRight size={18} />
                    Send
                  </button>

                  <button
                    className="secondary-button"
                    onClick={() => setModal('receive')}
                  >
                    <ArrowDownLeft size={18} />
                    Receive
                  </button>
                </div>
              </section>

              <section className="quick-stats">
                <div className="stat-card">
                  <div className="stat-icon">
                    <Wallet size={19} />
                  </div>
                  <div>
                    <small>Connected wallet</small>
                    <strong>{shortAddress(currentAddress) || 'Not connected'}</strong>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon">
                    <Coins size={19} />
                  </div>
                  <div>
                    <small>Visible tokens</small>
                    <strong>{tokens.length + 1}</strong>
                  </div>
                </div>
              </section>

              <section className="content-card">
                <div className="section-heading">
                  <div>
                    <h2>Your Assets</h2>
                    <p>Assets on the selected network</p>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => setActiveTab('Tokens')}
                  >
                    View all
                  </button>
                </div>

                <div className="asset-row">
                  <div className="asset-symbol">
                    {nativeSymbol.slice(0, 1)}
                  </div>

                  <div className="asset-details">
                    <strong>{nativeSymbol}</strong>
                    <small>{networkName} native asset</small>
                  </div>

                  <div className="asset-amount">
                    <strong>
                      {showBalance ? Number(balance).toFixed(5) : '••••'}
                    </strong>
                    <small>{nativeSymbol}</small>
                  </div>
                </div>

                {tokens.slice(0, 5).map((token, index) => (
                  <div className="asset-row" key={`${token.address}-${index}`}>
                    <div className="asset-symbol token-symbol">
                      {token.symbol.slice(0, 1)}
                    </div>

                    <div className="asset-details">
                      <strong>{token.symbol}</strong>
                      <small>{token.name}</small>
                    </div>

                    <div className="asset-amount">
                      <strong>
                        {showBalance ? token.balance : '••••'}
                      </strong>
                      <small>{token.symbol}</small>
                    </div>
                  </div>
                ))}

                {tokens.length === 0 && (
                  <div className="empty-state">
                    <Coins size={24} />
                    <p>No additional tokens loaded.</p>
                    <small>
                      You can add a token contract from the Tokens page.
                    </small>
                  </div>
                )}
              </section>

              <section className="content-card">
                <div className="section-heading">
                  <div>
                    <h2>Recent Activity</h2>
                    <p>Your recent wallet actions</p>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => setActiveTab('Activity')}
                  >
                    View activity
                  </button>
                </div>

                {activities.length === 0 ? (
                  <div className="empty-state">
                    <History size={24} />
                    <p>No transactions recorded yet.</p>
                  </div>
                ) : (
                  activities.slice(0, 5).map(activity => (
                    <div className="activity-row" key={activity.hash}>
                      <div className="activity-icon">
                        {activity.type === 'Send'
                          ? <ArrowUpRight size={19} />
                          : <ArrowDownLeft size={19} />}
                      </div>

                      <div className="activity-details">
                        <strong>{activity.type} {activity.symbol}</strong>
                        <small>
                          {new Date(activity.date).toLocaleString()}
                        </small>
                      </div>

                      <div className="activity-amount">
                        <strong>
                          {activity.type === 'Send' ? '-' : '+'}
                          {activity.amount} {activity.symbol}
                        </strong>
                        <a
                          href={getExplorerUrl(activity.hash, activity.network)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </>
          )}

          {activeTab === 'Tokens' && (
            <section className="content-card">
              <div className="section-heading">
                <div>
                  <h2>Token Portfolio</h2>
                  <p>Manage tokens on {networkName}</p>
                </div>

                <button
                  className="primary-button small-button"
                  onClick={() => setModal('token')}
                >
                  <Plus size={16} />
                  Add Token
                </button>
              </div>

              <div className="asset-row">
                <div className="asset-symbol">
                  {nativeSymbol.slice(0, 1)}
                </div>

                <div className="asset-details">
                  <strong>{nativeSymbol}</strong>
                  <small>{networkName} native asset</small>
                </div>

                <div className="asset-amount">
                  <strong>
                    {showBalance ? Number(balance).toFixed(6) : '••••'}
                  </strong>
                  <small>{nativeSymbol}</small>
                </div>
              </div>

              {tokens.map((token, index) => (
                <div className="asset-row" key={`${token.address}-${index}`}>
                  <div className="asset-symbol token-symbol">
                    {token.symbol.slice(0, 1)}
                  </div>

                  <div className="asset-details">
                    <strong>{token.symbol}</strong>
                    <small>{token.name}</small>
                  </div>

                  <div className="asset-amount">
                    <strong>
                      {showBalance ? token.balance : '••••'}
                    </strong>
                    <small>{token.symbol}</small>
                  </div>
                </div>
              ))}

              {tokens.length === 0 && (
                <div className="empty-state">
                  <Coins size={25} />
                  <p>No additional tokens available.</p>
                  <small>
                    Add a token contract address to display it.
                  </small>
                </div>
              )}
            </section>
          )}

          {activeTab === 'Activity' && (
            <section className="content-card">
              <div className="section-heading">
                <div>
                  <h2>Transaction History</h2>
                  <p>Transactions recorded during this session</p>
                </div>
              </div>

              {activities.length === 0 ? (
                <div className="empty-state">
                  <History size={25} />
                  <p>No transaction history available.</p>
                  <small>
                    This list currently records transactions submitted through this app.
                  </small>
                </div>
              ) : (
                activities.map(activity => (
                  <div className="activity-row" key={activity.hash}>
                    <div className="activity-icon">
                      {activity.type === 'Send'
                        ? <ArrowUpRight size={19} />
                        : <ArrowDownLeft size={19} />}
                    </div>

                    <div className="activity-details">
                      <strong>{activity.type} {activity.symbol}</strong>
                      <small>
                        {activity.network} · {new Date(activity.date).toLocaleString()}
                      </small>
                    </div>

                    <div className="activity-amount">
                      <strong>
                        {activity.type === 'Send' ? '-' : '+'}
                        {activity.amount} {activity.symbol}
                      </strong>
                      <a
                        href={getExplorerUrl(activity.hash, activity.network)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Explorer <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                ))
              )}
            </section>
          )}

          {activeTab === 'Settings' && (
            <section className="content-card settings-card">
              <div className="section-heading">
                <div>
                  <h2>Wallet Settings</h2>
                  <p>Manage your wallet connection</p>
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Wallet address</strong>
                  <small>{currentAddress || 'No address available'}</small>
                </div>

                <button
                  className="secondary-button small-button"
                  onClick={copyAddress}
                >
                  <Copy size={15} />
                  Copy
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Active network</strong>
                  <small>{networkName}</small>
                </div>
                <Globe size={20} />
              </div>

              <div className="settings-row">
                <div>
                  <strong>Account email</strong>
                  <small>{user?.email?.address || 'Not available'}</small>
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Solana wallet</strong>
                  <small>{shortAddress(solAddress) || 'Not connected'}</small>
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <strong>TRON wallet</strong>
                  <small>
                    {tronConnected
                      ? shortAddress(tronAddress)
                      : 'Connect through TronLink'}
                  </small>
                </div>

                {network === 'tron' && (
                  <button
                    className="secondary-button small-button"
                    onClick={() => void connectTron()}
                  >
                    Connect
                  </button>
                )}
              </div>

              <button
                className="logout-button settings-logout"
                onClick={logout}
              >
                <LogOut size={17} />
                Disconnect Wallet
              </button>
            </section>
          )}
          
        </main>
      </div>

      {modal === 'send' && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!loading) setModal(null);
          }}
        >
          <div
            className="modal-card"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Send Assets</h2>
                <p>Transfer crypto to another wallet</p>
              </div>

              <button
                className="icon-button"
                onClick={() => setModal(null)}
                disabled={loading}
              >
                <X size={20} />
              </button>
            </div>

            <label className="field-label">
              Network
            </label>

            <div className="selected-network">
              <Globe size={17} />
              {networkName}
              <span>{nativeSymbol}</span>
            </div>

            <label className="field-label">
              Recipient Address
            </label>

            <input
              className="form-input"
              value={recipient}
              onChange={event => setRecipient(event.target.value.trim())}
              placeholder={
                network === 'solana'
                  ? 'Solana address'
                  : network === 'tron'
                    ? 'TRON address'
                    : '0x...'
              }
            />

            {network !== 'tron' && network !== 'solana' && tokens.length > 0 && (
              <>
                <label className="field-label">
                  Asset
                </label>

                <select
                  className="form-input"
                  value={selectedToken?.address || ''}
                  onChange={event => {
                    const token = tokens.find(
                      item => item.address === event.target.value
                    );
                    setSelectedToken(token || null);
                  }}
                >
                  <option value="">Native {nativeSymbol}</option>
                  {tokens.map(token => (
                    <option
                      key={token.address}
                      value={token.address}
                    >
                      {token.symbol}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="field-label">
              Amount
            </label>

            <input
              className="form-input"
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={event => setAmount(event.target.value)}
              placeholder="0.00"
            />

            <div className="send-note">
              <AlertCircle size={16} />
              Check the recipient address and network before sending.
            </div>

            <button
              className="primary-button modal-submit"
              onClick={() => void handleSend()}
              disabled={loading || !recipient || !amount}
            >
              {loading ? (
                <>
                  <RefreshCw size={17} className="spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Send size={17} />
                  Confirm Send
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {modal === 'receive' && (
        <div
          className="modal-overlay"
          onClick={() => setModal(null)}
        >
          <div
            className="modal-card receive-modal"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Receive Assets</h2>
                <p>Your public wallet address</p>
              </div>

              <button
                className="icon-button"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div className="receive-network">
              <Globe size={17} />
              {networkName}
            </div>

            {currentAddress ? (
              <>
                <div className="qr-container">
                  <QRCodeSVG
                    value={currentAddress}
                    size={190}
                    level="H"
                    includeMargin
                  />
                </div>

                <div className="receive-address">
                  {currentAddress}
                </div>

                <button
                  className="primary-button modal-submit"
                  onClick={copyAddress}
                >
                  <Copy size={17} />
                  Copy Address
                </button>
              </>
            ) : (
              <div className="empty-state">
                <Wallet size={28} />
                <p>No wallet address available.</p>
                {network === 'tron' && (
                  <button
                    className="primary-button"
                    onClick={() => void connectTron()}
                  >
                    Connect TronLink
                  </button>
                )}
              </div>
            )}

            <p className="receive-warning">
              Only send assets supported by the selected network
              to this address.
            </p>
          </div>
        </div>
      )}

      {modal === 'token' && (
        <div
          className="modal-overlay"
          onClick={() => setModal(null)}
        >
          <div
            className="modal-card"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2>Add Token</h2>
                <p>Add a token contract to your wallet display</p>
              </div>

              <button
                className="icon-button"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>

            <label className="field-label">
              Token Contract Address
            </label>

            <input
              className="form-input"
              value={tokenAddress}
              onChange={event => setTokenAddress(event.target.value.trim())}
              placeholder="0x..."
            />

            <div className="send-note">
              <AlertCircle size={16} />
              This manual token addition is currently available for EVM networks.
            </div>

            <button
              className="primary-button modal-submit"
              disabled={!isEvm || !isAddress(tokenAddress) || loading}
              onClick={async () => {
                if (!publicClient || !isAddress(tokenAddress)) {
                  showError('Enter a valid EVM token contract address.');
                  return;
                }

                try {
                  setLoading(true);

                  const contract =
                    tokenAddress as `0x${string}`;

                  const [symbol, decimals, name, rawBalance] =
                    await Promise.all([
                      publicClient.readContract({
                        address: contract,
                        abi: erc20Abi,
                        functionName: 'symbol'
                      }),
                      publicClient.readContract({
                        address: contract,
                        abi: erc20Abi,
                        functionName: 'decimals'
                      }),
                      publicClient.readContract({
                        address: contract,
                        abi: erc20Abi,
                        functionName: 'name'
                      }),
                      publicClient.readContract({
                        address: contract,
                        abi: erc20Abi,
                        functionName: 'balanceOf',
                        args: [evmAddress as `0x${string}`]
                      })
                    ]);

                  const newToken: Token = {
                    symbol,
                    name,
                    address: contract,
                    decimals,
                    balance: formatUnits(rawBalance, decimals)
                  };

                  setTokens(previous => {
                    const exists = previous.some(
                      token =>
                        token.address?.toLowerCase() ===
                        contract.toLowerCase()
                    );

                    if (exists) return previous;

                    return [...previous, newToken];
                  });

                  setTokenAddress('');
                  setModal(null);
                  showSuccess(`${symbol} token added.`);
                } catch (err) {
                  showError(
                    `Unable to read token contract: ${getError(err)}`
                  );
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading ? 'Loading token...' : 'Add Token'}
            </button>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-brand">
          <span className="footer-logo">Y</span>
          <strong>YALO Wallet</strong>
        </div>

        <span>Manage your assets. Stay in control.</span>
      </footer>
    </div>
  );
            }
