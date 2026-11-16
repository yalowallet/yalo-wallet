
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
  ExternalLink,
  History,
  Settings,
  Coins,
  ShieldCheck,
  CheckCircle,
  AlertCircle,
  Globe,
  Eye,
  EyeOff,
  Plus
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
  address: string;
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
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [network, setNetwork] = useState<NetworkKey>('base');
  const [activeTab, setActiveTab] = useState('Overview');

  const [menuOpen, setMenuOpen] = useState(false);
  const [showBalance, setShowBalance] = useState(true);

  const [balance, setBalance] = useState('0');
  const [tokens, setTokens] = useState<Token[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);

  const [modal, setModal] = useState<
    'send' | 'receive' | 'token' | null
  >(null);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [tronAddress, setTronAddress] = useState('');
  const [tronConnected, setTronConnected] = useState(false);

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
  }, [network, solAddress, tronAddress, evmAddress]);

  const publicClient = useMemo(() => {
    if (!isEvm) return null;

    const config =
      EVM_NETWORKS[network as keyof typeof EVM_NETWORKS];

    return createPublicClient({
      chain: config.chain,
      transport: http(config.rpc)
    });
  }, [network, isEvm]);

  const showSuccess = useCallback((text: string) => {
    setMessage(text);
    setError('');
  }, []);

  const showError = useCallback((text: string) => {
    setError(text);
    setMessage('');
  }, []);

  const addActivity = useCallback((activity: Activity) => {
    setActivities(previous =>
      [activity, ...previous].slice(0, 50)
    );
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

        const lamports = await connection.getBalance(publicKey);

        setBalance((lamports / 1e9).toFixed(6));

        const tokenAccounts =
          await connection.getParsedTokenAccountsByOwner(
            publicKey,
            {
              programId: new PublicKey(
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
              )
            }
          );

        const solTokens: Token[] = tokenAccounts.value.map(account => {
          const info = account.account.data.parsed.info;

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

        if (!tron?.defaultAddress?.base58) {
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
        const rawBalance = await publicClient.getBalance({
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
      const tron = window.tronWeb;

      if (!tron) {
        showError(
          'TronLink not detected. Open YALO inside the TronLink browser.'
        );
        return;
      }

      if (!tron.defaultAddress?.base58) {
        showError('Please unlock your TronLink wallet.');
        return;
      }

      setTronAddress(tron.defaultAddress.base58);
      setTronConnected(true);
      showSuccess('TRON wallet connected.');
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

      const config = EVM_NETWORKS[key];

      return config ? `${config.explorer}${hash}` : '#';
    },
    [network]
  );
  
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

    try {
      setLoading(true);
      setError('');
      setMessage('');

      const config =
        EVM_NETWORKS[network as keyof typeof EVM_NETWORKS];

      const tokenAmount = parseUnits(
        amount,
        selectedToken.decimals
      );

      const data = (
        '0xa9059cbb' +
        recipient.slice(2).toLowerCase().padStart(64, '0') +
        tokenAmount.toString(16).padStart(64, '0')
      ) as `0x${string}`;

      const tx = await sendTransaction(
        {
          to: selectedToken.address as `0x${string}`,
          data,
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

    if (!isValidAmount(amount)) {
      showError('Enter a valid SOL amount.');
      return;
    }

    if (!recipient) {
      showError('Enter a recipient address.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setMessage('');

      const sender = new PublicKey(solAddress);
      const destination = new PublicKey(recipient);

      const connection = new Connection(SOLANA_RPC);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: destination,
          lamports: Math.round(Number(amount) * 1e9)
        })
      );

      transaction.feePayer = sender;

      const latestBlockhash =
        await connection.getLatestBlockhash();

      transaction.recentBlockhash =
        latestBlockhash.blockhash;

      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      let binary = '';

      for (let i = 0; i < serialized.length; i++) {
        binary += String.fromCharCode(serialized[i]);
      }

      const transactionBase64 = btoa(binary);

      const result = await signAndSendTransaction({
        transaction: transactionBase64,
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

    if (!tron?.defaultAddress?.base58) {
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
      setError('');
      setMessage('');

      const sun = Math.round(Number(amount) * 1e6);

      const result =
        await tron.trx.sendTransaction(recipient, sun);

      if (!result?.txid) {
        throw new Error(
          'TRON transaction was not confirmed by wallet.'
        );
      }

      addActivity({
        hash: result.txid,
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
  
  const addEvmToken = useCallback(async () => {
    if (!publicClient || !evmAddress) {
      showError('EVM wallet is not connected.');
      return;
    }

    if (!isAddress(tokenAddress)) {
      showError('Enter a valid token contract address.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setMessage('');

      const contract = tokenAddress as `0x${string}`;

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
            token.address.toLowerCase() ===
            contract.toLowerCase()
        );

        if (exists) {
          return previous.map(token =>
            token.address.toLowerCase() ===
            contract.toLowerCase()
              ? newToken
              : token
          );
        }

        return [...previous, newToken];
      });

      setTokenAddress('');
      setModal(null);

      showSuccess(`${symbol} token added successfully.`);
    } catch (err) {
      showError(
        `Unable to read token contract: ${getError(err)}`
      );
    } finally {
      setLoading(false);
    }
  }, [
    publicClient,
    evmAddress,
    tokenAddress,
    showError,
    showSuccess
  ]);

  const refreshTokenBalances = useCallback(async () => {
    if (!publicClient || !evmAddress) return;

    try {
      const updatedTokens = await Promise.all(
        tokens.map(async token => {
          try {
            const rawBalance =
              await publicClient.readContract({
                address: token.address as `0x${string}`,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [evmAddress as `0x${string}`]
              });

            return {
              ...token,
              balance: formatUnits(
                rawBalance,
                token.decimals
              )
            };
          } catch {
            return token;
          }
        })
      );

      setTokens(updatedTokens);
    } catch (err) {
      showError(getError(err));
    }
  }, [
    publicClient,
    evmAddress,
    tokens,
    showError
  ]);

  const removeToken = useCallback((address: string) => {
    setTokens(previous =>
      previous.filter(
        token =>
          token.address.toLowerCase() !==
          address.toLowerCase()
      )
    );

    showSuccess('Token removed from your wallet display.');
  }, [showSuccess]);

  const openSendModal = useCallback((token?: Token) => {
    setSelectedToken(token || null);
    setRecipient('');
    setAmount('');
    setModal('send');
    setError('');
    setMessage('');
  }, []);

  const openReceiveModal = useCallback(() => {
    setModal('receive');
    setError('');
    setMessage('');
  }, []);

  const closeModal = useCallback(() => {
    if (loading) return;

    setModal(null);
    setRecipient('');
    setAmount('');
    setTokenAddress('');
    setSelectedToken(null);
  }, [loading]);
    
  return (
    <div className="min-h-screen bg-[#090b0a] text-white">
      <div className="mx-auto flex min-h-screen max-w-[1500px]">
        <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-[#0d100e] p-6 lg:flex lg:flex-col">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-400 text-black">
              <Wallet size={25} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-wide">YALO</h1>
              <p className="text-xs text-gray-500">WALLET</p>
            </div>
          </div>

          <nav className="flex-1 space-y-2">
            {[
              { name: 'Overview', icon: Wallet },
              { name: 'Tokens', icon: Coins },
              { name: 'Activity', icon: History },
              { name: 'Settings', icon: Settings }
            ].map(item => {
              const Icon = item.icon;

              return (
                <button
                  key={item.name}
                  onClick={() => setActiveTab(item.name)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                    activeTab === item.name
                      ? 'bg-yellow-400 font-bold text-black'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon size={19} />
                  {item.name}
                </button>
              );
            })}
          </nav>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-2 text-yellow-400">
              <ShieldCheck size={18} />
              <span className="text-sm font-semibold">
                Wallet Security
              </span>
            </div>
            <p className="text-xs leading-5 text-gray-500">
              Keep your wallet credentials private. Never share your recovery information.
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-[#090b0a]/95 px-4 py-4 backdrop-blur md:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="rounded-lg border border-white/10 p-2 lg:hidden"
                aria-label="Open menu"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>

              <div className="lg:hidden">
                <h1 className="text-xl font-black">YALO</h1>
                <p className="text-[10px] tracking-widest text-gray-500">
                  WALLET
                </p>
              </div>

              <div className="hidden lg:block">
                <h2 className="text-xl font-bold">{activeTab}</h2>
                <p className="text-xs text-gray-500">
                  Manage your digital assets
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={network}
                onChange={event => {
                  setNetwork(event.target.value as NetworkKey);
                  setSelectedToken(null);
                }}
                className="max-w-[145px] rounded-xl border border-white/10 bg-[#151916] px-3 py-2 text-sm outline-none focus:border-yellow-400"
              >
                <option value="base">Base</option>
                <option value="ethereum">Ethereum</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="optimism">Optimism</option>
                <option value="polygon">Polygon</option>
                <option value="solana">Solana</option>
                <option value="tron">TRON</option>
              </select>

              {authenticated && (
                <button
                  onClick={() => void logout()}
                  className="rounded-xl border border-white/10 p-2 text-gray-400 hover:text-red-400"
                  title="Log out"
                >
                  <LogOut size={19} />
                </button>
              )}
            </div>
          </header>

          {menuOpen && (
            <div className="border-b border-white/10 bg-[#111512] p-4 lg:hidden">
              {[
                { name: 'Overview', icon: Wallet },
                { name: 'Tokens', icon: Coins },
                { name: 'Activity', icon: History },
                { name: 'Settings', icon: Settings }
              ].map(item => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.name}
                    onClick={() => {
                      setActiveTab(item.name);
                      setMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left ${
                      activeTab === item.name
                        ? 'text-yellow-400'
                        : 'text-gray-400'
                    }`}
                  >
                    <Icon size={18} />
                    {item.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="p-4 md:p-8">
            {!ready ? (
              <div className="flex min-h-[60vh] items-center justify-center">
                <div className="text-center">
                  <RefreshCw
                    className="mx-auto mb-3 animate-spin text-yellow-400"
                    size={30}
                  />
                  <p className="text-gray-400">
                    Loading YALO Wallet...
                  </p>
                </div>
              </div>
            ) : !authenticated ? (
              <div className="flex min-h-[70vh] items-center justify-center">
                <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111512] p-8 text-center">
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-400 text-black">
                    <Wallet size={34} />
                  </div>

                  <h2 className="mb-2 text-3xl font-black">
                    Welcome to YALO
                  </h2>
                  <p className="mb-7 text-sm leading-6 text-gray-400">
                    Your multi-chain wallet for managing digital assets.
                  </p>

                  <button
                    onClick={() => login()}
                    className="w-full rounded-xl bg-yellow-400 px-5 py-4 font-bold text-black transition hover:bg-yellow-300"
                  >
                    Connect Wallet
                  </button>

                  <p className="mt-5 text-xs text-gray-600">
                    Secure wallet access powered by Privy
                  </p>
                </div>
              </div>
            ) : (
              <>
                {(message || error) && (
                  <div className={`mb-5 flex items-start gap-3 rounded-xl border p-4 ${
                    error
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-green-500/30 bg-green-500/10 text-green-300'
                  }`}>
                    {error ? (
                      <AlertCircle size={19} className="mt-0.5 shrink-0" />
                    ) : (
                      <CheckCircle size={19} className="mt-0.5 shrink-0" />
                    )}
                    <p className="flex-1 break-words text-sm">
                      {error || message}
                    </p>
                    <button
                      onClick={() => {
                        setError('');
                        setMessage('');
                      }}
                      aria-label="Close message"
                    >
                      <X size={17} />
                    </button>
                  </div>
                )}

                {activeTab === 'Overview' && (
                  <div className="space-y-6">
                    <section className="rounded-3xl bg-gradient-to-br from-yellow-300 to-yellow-500 p-6 text-black md:p-8">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-black/70">
                            Total wallet balance
                          </p>

                          <div className="mt-3 flex items-center gap-3">
                            <h2 className="text-3xl font-black md:text-4xl">
                              {showBalance
                                ? `${Number(balance || 0).toFixed(5)} ${nativeSymbol}`
                                : '••••••••'}
                            </h2>

                            <button
                              onClick={() => setShowBalance(!showBalance)}
                              aria-label="Toggle balance visibility"
                            >
                              {showBalance ? (
                                <EyeOff size={20} />
                              ) : (
                                <Eye size={20} />
                              )}
                            </button>
                          </div>

                          <p className="mt-3 text-xs text-black/60">
                            {networkName} network
                          </p>
                        </div>

                        <button
                          onClick={() => void refreshBalance()}
                          disabled={refreshing}
                          className="rounded-xl bg-black/10 p-3 transition hover:bg-black/20 disabled:opacity-50"
                          title="Refresh balance"
                        >
                          <RefreshCw
                            size={21}
                            className={refreshing ? 'animate-spin' : ''}
                          />
                        </button>
                      </div>

                      <div className="mt-8 grid grid-cols-2 gap-3">
                        <button
                          onClick={() => openSendModal()}
                          className="flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 font-bold text-white transition hover:bg-black/80"
                        >
                          <ArrowUpRight size={19} />
                          Send
                        </button>

                        <button
                          onClick={openReceiveModal}
                          className="flex items-center justify-center gap-2 rounded-xl border border-black/20 bg-white/30 px-4 py-3 font-bold transition hover:bg-white/50"
                        >
                          <ArrowDownLeft size={19} />
                          Receive
                        </button>
                      </div>
                    </section>

                    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm text-gray-400">
                            Active network
                          </span>
                          <Globe className="text-yellow-400" size={20} />
                        </div>
                        <p className="text-xl font-bold">{networkName}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {network === 'tron'
                            ? tronConnected
                              ? 'TronLink connected'
                              : 'TronLink not connected'
                            : currentAddress
                              ? 'Wallet connected'
                              : 'Wallet address unavailable'}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm text-gray-400">
                            Wallet address
                          </span>
                          <Copy className="text-yellow-400" size={19} />
                        </div>
                        <p className="break-all text-sm font-semibold">
                          {currentAddress
                            ? shortAddress(currentAddress)
                            : 'Not connected'}
                        </p>
                        <button
                          onClick={() => void copyAddress()}
                          disabled={!currentAddress}
                          className="mt-2 text-xs font-semibold text-yellow-400 disabled:opacity-40"
                        >
                          Copy address
                        </button>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                      <div className="mb-5 flex items-center justify-between">
                        <h3 className="text-lg font-bold">Your tokens</h3>
                        <button
                          onClick={() => setActiveTab('Tokens')}
                          className="text-sm text-yellow-400"
                        >
                          View all
                        </button>
                      </div>

                      {tokens.length === 0 ? (
                        <p className="py-5 text-center text-sm text-gray-500">
                          No additional tokens added on this network.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {tokens.slice(0, 4).map(token => (
                            <div
                              key={token.address}
                              className="flex items-center justify-between gap-3 border-b border-white/5 pb-3 last:border-0"
                            >
                              <div className="min-w-0">
                                <p className="font-semibold">{token.symbol}</p>
                                <p className="truncate text-xs text-gray-500">
                                  {token.name}
                                </p>
                              </div>
                              <p className="text-sm font-semibold">
                                {Number(token.balance).toFixed(5)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
      
                {activeTab === 'Tokens' && (
                  <section className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-bold">Tokens</h2>
                        <p className="mt-1 text-xs text-gray-500">
                          Assets on {networkName}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        {isEvm && (
                          <button
                            onClick={() => setModal('token')}
                            className="flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-bold text-black"
                          >
                            <Plus size={17} />
                            Add token
                          </button>
                        )}

                        {isEvm && (
                          <button
                            onClick={() => void refreshTokenBalances()}
                            className="rounded-xl border border-white/10 p-2.5 text-yellow-400"
                            title="Refresh token balances"
                          >
                            <RefreshCw size={18} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs text-gray-500">Native asset</p>
                      <div className="mt-2 flex items-center justify-between">
                        <div>
                          <p className="font-bold">{nativeSymbol}</p>
                          <p className="text-xs text-gray-500">
                            {networkName}
                          </p>
                        </div>
                        <p className="font-bold">
                          {showBalance
                            ? Number(balance).toFixed(6)
                            : '••••••'}
                        </p>
                      </div>
                    </div>

                    {tokens.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-500">
                        No additional tokens added.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {tokens.map(token => (
                          <div
                            key={token.address}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 p-4"
                          >
                            <div className="min-w-0">
                              <p className="font-bold">{token.symbol}</p>
                              <p className="truncate text-xs text-gray-500">
                                {token.name}
                              </p>
                              <p className="mt-1 break-all text-[10px] text-gray-600">
                                {token.address}
                              </p>
                            </div>

                            <div className="text-right">
                              <p className="font-semibold">
                                {showBalance
                                  ? Number(token.balance).toFixed(6)
                                  : '••••••'}
                              </p>

                              {isEvm && (
                                <div className="mt-2 flex gap-3">
                                  <button
                                    onClick={() => openSendModal(token)}
                                    className="text-xs text-yellow-400"
                                  >
                                    Send
                                  </button>

                                  <button
                                    onClick={() => removeToken(token.address)}
                                    className="text-xs text-red-400"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {activeTab === 'Activity' && (
                  <section className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                    <h2 className="mb-2 text-xl font-bold">
                      Transaction activity
                    </h2>

                    <p className="mb-5 text-xs text-gray-500">
                      Transactions submitted during this app session.
                    </p>

                    {activities.length === 0 ? (
                      <div className="py-12 text-center">
                        <History
                          className="mx-auto mb-3 text-gray-600"
                          size={35}
                        />
                        <p className="text-sm text-gray-500">
                          No activity recorded in this session.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {activities.map((activity, index) => (
                          <div
                            key={`${activity.hash}-${index}`}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 p-4"
                          >
                            <div className="flex items-center gap-3">
                              <div className="rounded-xl bg-white/5 p-3">
                                <ArrowUpRight
                                  className="text-yellow-400"
                                  size={19}
                                />
                              </div>

                              <div>
                                <p className="font-semibold">
                                  {activity.type} {activity.symbol}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {activity.network} ·{' '}
                                  {new Date(activity.date).toLocaleString()}
                                </p>
                              </div>
                            </div>

                            <div className="text-right">
                              <p className="font-bold">
                                {activity.amount} {activity.symbol}
                              </p>

                              <a
                                href={getExplorerUrl(
                                  activity.hash,
                                  activity.network
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs text-yellow-400"
                              >
                                View transaction
                                <ExternalLink size={12} />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {activeTab === 'Settings' && (
                  <section className="space-y-5">
                    <div className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                      <h2 className="text-xl font-bold">Settings</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        Manage your wallet preferences and connections.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                      <h3 className="mb-4 font-bold">
                        Wallet information
                      </h3>

                      <div className="space-y-4">
                        <div>
                          <p className="mb-1 text-xs text-gray-500">
                            Current network
                          </p>
                          <p className="font-semibold">{networkName}</p>
                        </div>

                        <div>
                          <p className="mb-1 text-xs text-gray-500">
                            Wallet address
                          </p>

                          <div className="flex items-center gap-2">
                            <p className="min-w-0 flex-1 break-all text-sm">
                              {currentAddress || 'No address available'}
                            </p>

                            <button
                              onClick={() => void copyAddress()}
                              disabled={!currentAddress}
                              className="rounded-lg border border-white/10 p-2 text-yellow-400 disabled:opacity-40"
                            >
                              <Copy size={17} />
                            </button>
                          </div>
                        </div>

                        <div>
                          <p className="mb-1 text-xs text-gray-500">
                            Account email
                          </p>
                          <p className="break-all text-sm">
                            {user?.email?.address || 'Not available'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                      <h3 className="mb-4 font-bold">
                        Network connection
                      </h3>

                      {network === 'tron' ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold">TronLink</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {tronConnected
                                ? 'Wallet connected'
                                : 'Wallet not connected'}
                            </p>
                          </div>

                          <button
                            onClick={() => void connectTron()}
                            className="rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-bold text-black"
                          >
                            {tronConnected ? 'Reconnect' : 'Connect TRON'}
                          </button>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">
                          {networkName} selected.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#111512] p-5">
                      <h3 className="mb-3 font-bold">
                        Display preferences
                      </h3>

                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            Wallet balance visibility
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            Hide or show your balance.
                          </p>
                        </div>

                        <button
                          onClick={() => setShowBalance(!showBalance)}
                          className={`rounded-full px-4 py-2 text-xs font-bold ${
                            showBalance
                              ? 'bg-yellow-400 text-black'
                              : 'bg-white/10 text-white'
                          }`}
                        >
                          {showBalance ? 'Visible' : 'Hidden'}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                      <h3 className="font-bold text-red-400">
                        Account
                      </h3>

                      <p className="mt-2 text-sm text-gray-400">
                        Disconnect your current YALO Wallet session.
                      </p>

                      <button
                        onClick={() => void logout()}
                        className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-3 text-sm font-semibold text-red-400 hover:bg-red-500/10"
                      >
                        <LogOut size={17} />
                        Disconnect wallet
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {modal && authenticated && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={event => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111512] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {modal === 'send'
                  ? 'Send Assets'
                  : modal === 'receive'
                    ? 'Receive Assets'
                    : 'Add Token'}
              </h2>

              <button
                onClick={closeModal}
                disabled={loading}
                className="rounded-lg border border-white/10 p-2 text-gray-400 hover:text-white disabled:opacity-40"
              >
                <X size={19} />
              </button>
            </div>

            {modal === 'send' && (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-gray-400">
                    Network
                  </label>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm font-semibold">
                    {networkName}
                  </div>
                </div>

                {selectedToken && (
                  <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-3">
                    <p className="text-xs text-gray-500">
                      Selected token
                    </p>
                    <p className="font-bold text-yellow-400">
                      {selectedToken.symbol}
                    </p>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-sm text-gray-400">
                    Recipient address
                  </label>
                  <input
                    value={recipient}
                    onChange={event => setRecipient(event.target.value.trim())}
                    placeholder={
                      network === 'solana'
                        ? 'Solana address'
                        : network === 'tron'
                          ? 'TRON address'
                          : '0x...'
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm outline-none focus:border-yellow-400"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-gray-400">
                    Amount ({selectedToken?.symbol || nativeSymbol})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amount}
                    onChange={event => setAmount(event.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm outline-none focus:border-yellow-400"
                  />
                </div>

                <button
                  onClick={() => void handleSend()}
                  disabled={loading || !recipient || !isValidAmount(amount)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-400 py-4 font-bold text-black transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Send size={18} />
                      Continue
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-gray-600">
                  Always verify the recipient address and network before approving.
                </p>
              </div>
            )}

            {modal === 'receive' && (
              <div className="space-y-5 text-center">
                <p className="text-sm text-gray-400">
                  Receive {nativeSymbol} on {networkName}.
                </p>

                {currentAddress ? (
                  <>
                    <div className="mx-auto flex w-fit items-center justify-center rounded-2xl bg-white p-4">
                      <QRCodeSVG
                        value={currentAddress}
                        size={190}
                        level="H"
                      />
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="break-all text-sm">
                        {currentAddress}
                      </p>
                    </div>

                    <button
                      onClick={() => void copyAddress()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-400 py-3 font-bold text-black"
                    >
                      <Copy size={18} />
                      Copy address
                    </button>
                  </>
                ) : (
                  <p className="rounded-xl bg-white/5 p-5 text-sm text-gray-400">
                    No wallet address available for this network.
                  </p>
                )}

                <p className="text-xs text-red-400">
                  Only send assets supported by the selected network to this address.
                </p>
              </div>
            )}

            {modal === 'token' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  Add an ERC-20 token using its contract address on {networkName}.
                </p>

                <div>
                  <label className="mb-2 block text-sm text-gray-400">
                    Token contract address
                  </label>

                  <input
                    value={tokenAddress}
                    onChange={event => setTokenAddress(event.target.value.trim())}
                    placeholder="0x..."
                    className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm outline-none focus:border-yellow-400"
                  />
                </div>

                <button
                  onClick={() => void addEvmToken()}
                  disabled={loading || !isAddress(tokenAddress)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-400 py-4 font-bold text-black disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Loading token...
                    </>
                  ) : (
                    <>
                      <Plus size={18} />
                      Add token
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
