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

function encodeBase58(bytes: Uint8Array): string {
  const alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  let value = 0n;

  for (const byte of bytes) {
    value = (value * 256n) + BigInt(byte);
  }

  let encoded = '';

  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = alphabet[remainder] + encoded;
    value = value / 58n;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = '1' + encoded;
  }

  return encoded || '1';
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
    
  const sendSolana = useCallback(async () => {
    if (!solWallet || !solAddress) {
      showError('Solana wallet is not connected.');
      return;
    }

    try {
      if (!isValidAmount(amount)) {
        showError('Enter a valid SOL amount.');
        return;
      }

      let recipientKey: PublicKey;

      try {
        recipientKey = new PublicKey(recipient);
      } catch {
        showError('Enter a valid Solana address.');
        return;
      }

      setLoading(true);
      setError('');
      setMessage('');

      const connection = new Connection(SOLANA_RPC);
      const senderKey = new PublicKey(solAddress);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: senderKey,
          toPubkey: recipientKey,
          lamports: Math.round(Number(amount) * 1e9)
        })
      );

      const latestBlockhash =
        await connection.getLatestBlockhash('confirmed');

      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = senderKey;

      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });

      const result = await signAndSendTransaction({
        transaction: serialized,
        wallet: solWallet
      });

      const signature = encodeBase58(result.signature);

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

      showSuccess('Solana transaction submitted.');
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

    if (!tronConnected || !tron?.defaultAddress?.base58) {
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

      const sender = tron.defaultAddress.base58;

      const sunAmount = Math.floor(Number(amount) * 1e6);

      const result = await tron.trx.sendTransaction(
        recipient,
        sunAmount
      );

      const hash =
        result?.txid ||
        result?.transaction?.txID;

      if (!hash) {
        throw new Error('TRON transaction hash was not returned.');
      }

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

      showSuccess('TRON transaction submitted.');
      void refreshBalance();
    } catch (err) {
      showError(getError(err));
    } finally {
      setLoading(false);
    }
  }, [
    tronConnected,
    recipient,
    amount,
    addActivity,
    showError,
    showSuccess,
    refreshBalance
  ]);
  
  const addEvmToken = useCallback(async () => {
    if (!publicClient || !evmAddress) {
      showError('Connect your EVM wallet first.');
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

      const address = tokenAddress as `0x${string}`;

      const [name, symbol, decimals, rawBalance] =
        await Promise.all([
          publicClient.readContract({
            address,
            abi: erc20Abi,
            functionName: 'name'
          }),
          publicClient.readContract({
            address,
            abi: erc20Abi,
            functionName: 'symbol'
          }),
          publicClient.readContract({
            address,
            abi: erc20Abi,
            functionName: 'decimals'
          }),
          publicClient.readContract({
            address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [evmAddress as `0x${string}`]
          })
        ]);

      const newToken: Token = {
        name,
        symbol,
        address,
        decimals,
        balance: formatUnits(rawBalance, decimals)
      };

      setTokens(previous => {
        const exists = previous.some(
          token =>
            token.address.toLowerCase() === address.toLowerCase()
        );

        if (exists) return previous;

        return [...previous, newToken];
      });

      setTokenAddress('');
      setModal(null);

      showSuccess(`${symbol} token added successfully.`);
    } catch (err) {
      showError(getError(err));
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
    if (!publicClient || !evmAddress || tokens.length === 0) {
      return;
    }

    try {
      const updatedTokens = await Promise.all(
        tokens.map(async token => {
          const rawBalance = await publicClient.readContract({
            address: token.address as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [evmAddress as `0x${string}`]
          });

          return {
            ...token,
            balance: formatUnits(rawBalance, token.decimals)
          };
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
          token.address.toLowerCase() !== address.toLowerCase()
      )
    );

    setSelectedToken(previous =>
      previous?.address.toLowerCase() === address.toLowerCase()
        ? null
        : previous
    );

    showSuccess('Token removed from your list.');
  }, [showSuccess]);

  const handleSend = useCallback(async () => {
    if (network === 'solana') {
      await sendSolana();
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
    sendSolana,
    sendTron,
    sendEvmToken,
    sendEvmNative
  ]);

  const openSendModal = useCallback(() => {
    setRecipient('');
    setAmount('');
    setSelectedToken(null);
    setError('');
    setMessage('');
    setModal('send');
  }, []);

  const openReceiveModal = useCallback(() => {
    setError('');
    setMessage('');
    setModal('receive');
  }, []);

  const openTokenModal = useCallback(() => {
    setTokenAddress('');
    setError('');
    setMessage('');
    setModal('token');
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setError('');
    setMessage('');
    setRecipient('');
    setAmount('');
    setTokenAddress('');
    setSelectedToken(null);
  }, []);

  return (
    <div className="min-h-screen bg-[#080b09] text-white">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-[#0c100d] p-5 md:flex md:flex-col">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-400 text-black">
              <Wallet size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wide">YALO</h1>
              <p className="text-xs text-gray-500">Digital Wallet</p>
            </div>
          </div>

          {authenticated && (
            <>
              <nav className="space-y-2">
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
                      className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                        activeTab === item.name
                          ? 'bg-lime-400 text-black'
                          : 'text-gray-400 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <Icon size={19} />
                      <span className="font-medium">{item.name}</span>
                    </button>
                  );
                })}
              </nav>

              <div className="mt-auto rounded-2xl border border-white/10 bg-[#121813] p-4">
                <div className="mb-2 flex items-center gap-2 text-lime-400">
                  <ShieldCheck size={18} />
                  <span className="text-sm font-semibold">Secure Wallet</span>
                </div>
                <p className="text-xs leading-5 text-gray-500">
                  Your wallet access is protected by Privy authentication.
                </p>
              </div>
            </>
          )}
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-7">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="rounded-lg p-2 text-gray-400 hover:bg-white/10 md:hidden"
              >
                {menuOpen ? <X size={21} /> : <Menu size={21} />}
              </button>

              <div>
                <h2 className="text-lg font-bold">YALO Wallet</h2>
                <p className="text-xs text-gray-500">
                  Secure digital asset management
                </p>
              </div>
            </div>

            {authenticated ? (
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-gray-400 sm:inline">
                  {shortAddress(currentAddress)}
                </span>
                <button
                  onClick={() => void copyAddress()}
                  className="rounded-lg border border-white/10 p-2 text-gray-400 hover:text-lime-400"
                  title="Copy wallet address"
                >
                  <Copy size={17} />
                </button>
                <button
                  onClick={() => void logout()}
                  className="rounded-lg border border-white/10 p-2 text-gray-400 hover:text-red-400"
                  title="Log out"
                >
                  <LogOut size={17} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => login()}
                disabled={!ready}
                className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-bold text-black hover:bg-lime-300 disabled:opacity-50"
              >
                Connect Wallet
              </button>
            )}
          </header>

          {menuOpen && authenticated && (
            <div className="border-b border-white/10 bg-[#0c100d] p-4 md:hidden">
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
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 ${
                      activeTab === item.name
                        ? 'bg-lime-400 text-black'
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

          {!authenticated ? (
            <div className="flex min-h-[75vh] items-center justify-center px-5">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101611] p-8 text-center">
                <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-lime-400 text-black">
                  <Wallet size={38} />
                </div>

                <h2 className="mb-3 text-3xl font-bold">
                  Welcome to YALO
                </h2>

                <p className="mb-8 text-sm leading-6 text-gray-400">
                  Connect your wallet to manage your digital assets,
                  send and receive crypto, and view your transactions.
                </p>

                <button
                  onClick={() => login()}
                  disabled={!ready}
                  className="w-full rounded-xl bg-lime-400 py-3 font-bold text-black hover:bg-lime-300 disabled:opacity-50"
                >
                  {ready ? 'Connect Wallet' : 'Loading...'}
                </button>

                <p className="mt-5 text-xs text-gray-600">
                  Powered by Privy wallet authentication
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 sm:p-7">
              {message && (
                <div className="mb-5 flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-400">
                  <CheckCircle size={18} />
                  {message}
                </div>
              )}

              {error && (
                <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                  <AlertCircle size={18} />
                  <span className="break-words">{error}</span>
                </div>
              )}

              {activeTab === 'Overview' && (
                <div className="space-y-6">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div>
                      <h2 className="text-2xl font-bold">Overview</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        Manage your wallet and assets
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void refreshBalance()}
                        disabled={refreshing}
                        className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
                      >
                        <RefreshCw
                          size={16}
                          className={refreshing ? 'animate-spin' : ''}
                        />
                        Refresh
                      </button>

                      <button
                        onClick={openReceiveModal}
                        className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/5"
                      >
                        <ArrowDownLeft size={16} />
                        Receive
                      </button>

                      <button
                        onClick={openSendModal}
                        className="flex items-center gap-2 rounded-xl bg-lime-400 px-4 py-2.5 text-sm font-bold text-black hover:bg-lime-300"
                      >
                        <Send size={16} />
                        Send
                      </button>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#18251a] to-[#0d120e] p-6 sm:p-8">
                    <div className="mb-6 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-400">
                          Available Balance
                        </p>
                        <div className="mt-3 flex items-center gap-3">
                          <h3 className="break-all text-3xl font-bold sm:text-4xl">
                            {showBalance
                              ? `${Number(balance).toLocaleString(undefined, {
                                  maximumFractionDigits: 6
                                })} ${nativeSymbol}`
                              : '••••••••'}
                          </h3>

                          <button
                            onClick={() => setShowBalance(!showBalance)}
                            className="text-gray-400 hover:text-lime-400"
                          >
                            {showBalance
                              ? <EyeOff size={19} />
                              : <Eye size={19} />}
                          </button>
                        </div>
                      </div>

                      <div className="hidden h-14 w-14 items-center justify-center rounded-2xl bg-lime-400/10 text-lime-400 sm:flex">
                        <Coins size={28} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                      <div>
                        <p className="text-xs text-gray-500">Wallet Address</p>
                        <p className="mt-1 font-mono text-sm text-gray-300">
                          {shortAddress(currentAddress)}
                        </p>
                      </div>

                      <button
                        onClick={() => void copyAddress()}
                        className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:border-lime-400/50"
                      >
                        <Copy size={14} />
                        Copy Address
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#101611] p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="font-semibold">Select Network</h3>
                      <Globe size={18} className="text-lime-400" />
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { key: 'base', name: 'Base' },
                        { key: 'ethereum', name: 'Ethereum' },
                        { key: 'arbitrum', name: 'Arbitrum' },
                        { key: 'optimism', name: 'Optimism' },
                        { key: 'polygon', name: 'Polygon' },
                        { key: 'solana', name: 'Solana' },
                        { key: 'tron', name: 'TRON' }
                      ].map(item => (
                        <button
                          key={item.key}
                          onClick={() => {
                            setNetwork(item.key as NetworkKey);
                            setError('');
                            setMessage('');
                          }}
                          className={`rounded-xl border px-3 py-3 text-sm font-medium transition ${
                            network === item.key
                              ? 'border-lime-400 bg-lime-400/10 text-lime-400'
                              : 'border-white/10 text-gray-400 hover:border-white/30'
                          }`}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-[#101611] p-5">
                      <div className="mb-3 flex items-center gap-2 text-gray-400">
                        <Coins size={18} />
                        <span className="text-sm">Network</span>
                      </div>
                      <p className="text-xl font-bold">{networkName}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Current active network
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#101611] p-5">
                      <div className="mb-3 flex items-center gap-2 text-gray-400">
                        <History size={18} />
                        <span className="text-sm">Transactions</span>
                      </div>
                      <p className="text-xl font-bold">
                        {activities.length}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Recent activity on this session
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {activeTab === 'Tokens' && (
                <div className="space-y-6">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <h2 className="text-2xl font-bold">My Tokens</h2>
                      <p className="mt-1 text-sm text-gray-500">
                        View and manage your token balances
                      </p>
                    </div>

                    <button
                      onClick={openTokenModal}
                      disabled={!isEvm}
                      className="flex items-center justify-center gap-2 rounded-xl bg-lime-400 px-4 py-3 text-sm font-bold text-black hover:bg-lime-300 disabled:opacity-40"
                    >
                      <Plus size={17} />
                      Add Token
                    </button>
                  </div>

                  {!isEvm && (
                    <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm text-yellow-400">
                      Custom ERC-20 tokens can be added on EVM networks.
                    </div>
                  )}

                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101611]">
                    <div className="flex items-center justify-between border-b border-white/10 p-5">
                      <h3 className="font-semibold">Token List</h3>

                      <button
                        onClick={() => void refreshTokenBalances()}
                        disabled={refreshing}
                        className="flex items-center gap-2 text-sm text-gray-400 hover:text-lime-400"
                      >
                        <RefreshCw
                          size={15}
                          className={refreshing ? 'animate-spin' : ''}
                        />
                        Refresh
                      </button>
                    </div>

                    {tokens.length === 0 ? (
                      <div className="p-10 text-center">
                        <Coins
                          size={36}
                          className="mx-auto mb-3 text-gray-600"
                        />
                        <p className="font-medium text-gray-300">
                          No tokens added
                        </p>
                        <p className="mt-2 text-sm text-gray-500">
                          Add a token contract to display its balance.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/10">
                        {tokens.map(token => (
                          <div
                            key={token.address}
                            className="flex flex-wrap items-center justify-between gap-3 p-5"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold">
                                {token.symbol}
                              </p>
                              <p className="text-xs text-gray-500">
                                {token.name}
                              </p>
                              <p className="mt-1 break-all font-mono text-xs text-gray-600">
                                {shortAddress(token.address)}
                              </p>
                            </div>

                            <div className="flex items-center gap-3">
                              <p className="text-right font-semibold">
                                {Number(token.balance).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 6 }
                                )}
                              </p>

                              <button
                                onClick={() => {
                                  setSelectedToken(token);
                                  openSendModal();
                                }}
                                className="rounded-lg border border-white/10 p-2 text-gray-400 hover:border-lime-400 hover:text-lime-400"
                                title="Send token"
                              >
                                <Send size={16} />
                              </button>

                              <button
                                onClick={() => removeToken(token.address)}
                                className="rounded-lg border border-white/10 p-2 text-gray-500 hover:border-red-500 hover:text-red-400"
                                title="Remove token"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'Activity' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold">Activity</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      Your recent wallet transactions
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101611]">
                    {activities.length === 0 ? (
                      <div className="p-12 text-center">
                        <History
                          size={36}
                          className="mx-auto mb-3 text-gray-600"
                        />
                        <p className="font-medium text-gray-300">
                          No transactions yet
                        </p>
                        <p className="mt-2 text-sm text-gray-500">
                          Your submitted transactions will appear here.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/10">
                        {activities.map((activity, index) => (
                          <div
                            key={`${activity.hash}-${index}`}
                            className="flex flex-wrap items-center justify-between gap-3 p-5"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                activity.type === 'Send'
                                  ? 'bg-red-500/10 text-red-400'
                                  : 'bg-green-500/10 text-green-400'
                              }`}>
                                {activity.type === 'Send'
                                  ? <ArrowUpRight size={20} />
                                  : <ArrowDownLeft size={20} />}
                              </div>

                              <div className="min-w-0">
                                <p className="font-semibold">
                                  {activity.type} {activity.symbol}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {activity.network}
                                </p>
                                <p className="mt-1 text-xs text-gray-600">
                                  {new Date(activity.date).toLocaleString()}
                                </p>
                              </div>
                            </div>

                            <div className="text-right">
                              <p className="font-semibold">
                                {activity.amount} {activity.symbol}
                              </p>
                              <a
                                href={getExplorerUrl(
                                  activity.hash,
                                  activity.network
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs text-lime-400 hover:underline"
                              >
                                View transaction
                                <ExternalLink size={12} />
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'Settings' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold">Settings</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      Wallet information and connection settings
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#101611] p-5">
                    <h3 className="mb-4 font-semibold">Wallet Information</h3>

                    <div className="space-y-4">
                      <div>
                        <p className="text-xs text-gray-500">Wallet Address</p>
                        <p className="mt-1 break-all font-mono text-sm">
                          {currentAddress || 'Not connected'}
                        </p>
                      </div>

                      <div className="border-t border-white/10 pt-4">
                        <p className="text-xs text-gray-500">Active Network</p>
                        <p className="mt-1 font-medium">{networkName}</p>
                      </div>

                      <div className="border-t border-white/10 pt-4">
                        <p className="text-xs text-gray-500">Account Email</p>
                        <p className="mt-1 font-medium">
                          {user?.email?.address || 'Not available'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => void copyAddress()}
                      className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm hover:border-lime-400/50"
                    >
                      <Copy size={16} />
                      Copy Wallet Address
                    </button>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#101611] p-5">
                    <h3 className="mb-2 font-semibold">TRON Wallet</h3>
                    <p className="mb-4 text-sm text-gray-500">
                      Connect using the TronLink browser wallet.
                    </p>

                    <div className="mb-4 break-all font-mono text-sm text-gray-400">
                      {tronAddress || 'No TRON wallet detected'}
                    </div>

                    <button
                      onClick={() => void connectTron()}
                      className="rounded-xl border border-white/10 px-4 py-3 text-sm hover:border-lime-400/50"
                    >
                      {tronConnected ? 'Reconnect TRON' : 'Connect TronLink'}
                    </button>
                  </div>

                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                    <h3 className="mb-2 font-semibold text-red-400">
                      Sign Out
                    </h3>
                    <p className="mb-4 text-sm text-gray-500">
                      Disconnect your current YALO wallet session.
                    </p>

                    <button
                      onClick={() => void logout()}
                      className="flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10"
                    >
                      <LogOut size={16} />
                      Log Out
                    </button>
                  </div>
                </div>
              )}
              
              {modal === 'send' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                  <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101611] p-6 shadow-2xl">
                    <div className="mb-6 flex items-center justify-between">
                      <h3 className="text-xl font-bold">Send Crypto</h3>
                      <button
                        onClick={closeModal}
                        className="rounded-lg p-2 text-gray-400 hover:bg-white/10"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="mb-5 rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs text-gray-500">Network</p>
                      <p className="mt-1 font-semibold">{networkName}</p>
                    </div>

                    {network === 'tron' && !tronConnected && (
                      <div className="mb-4 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-400">
                        Connect TronLink before sending TRX.
                        <button
                          onClick={() => void connectTron()}
                          className="ml-2 underline"
                        >
                          Connect
                        </button>
                      </div>
                    )}

                    {network === 'solana' && (
                      <p className="mb-4 text-xs text-gray-500">
                        Sending native SOL on Solana.
                      </p>
                    )}

                    {isEvm && tokens.length > 0 && (
                      <div className="mb-4">
                        <label className="mb-2 block text-sm text-gray-400">
                          Asset
                        </label>

                        <select
                          value={selectedToken?.address || 'native'}
                          onChange={value => {
                            const token = tokens.find(
                              item => item.address === value
                            );

                            setSelectedToken(token || null);
                          }}
                          className="w-full rounded-xl border border-white/10 bg-[#080b09] px-4 py-3 text-white outline-none"
                        >
                          <option value="native">
                            Native {nativeSymbol}
                          </option>

                          {tokens.map(token => (
                            <option
                              key={token.address}
                              value={token.address}
                            >
                              {token.symbol}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="mb-4">
                      <label className="mb-2 block text-sm text-gray-400">
                        Recipient Address
                      </label>
                      <input
                        type="text"
                        value={recipient}
                        onChange={event => setRecipient(event.target.value)}
                        placeholder="Enter recipient wallet address"
                        className="w-full rounded-xl border border-white/10 bg-[#080b09] px-4 py-3 text-sm text-white outline-none focus:border-lime-400"
                      />
                    </div>

                    <div className="mb-6">
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
                        className="w-full rounded-xl border border-white/10 bg-[#080b09] px-4 py-3 text-white outline-none focus:border-lime-400"
                      />
                    </div>

                    <button
                      onClick={() => void handleSend()}
                      disabled={loading || !recipient || !amount}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-lime-400 py-3 font-bold text-black hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <RefreshCw size={17} className="animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Send size={17} />
                          Send {selectedToken?.symbol || nativeSymbol}
                        </>
                      )}
                    </button>

                    <p className="mt-4 text-center text-xs text-gray-600">
                      Check the network and recipient address before confirming.
                    </p>
                  </div>
                </div>
              )}

              {modal === 'receive' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                  <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101611] p-6 text-center shadow-2xl">
                    <div className="mb-5 flex items-center justify-between">
                      <h3 className="text-xl font-bold">Receive Crypto</h3>
                      <button
                        onClick={closeModal}
                        className="rounded-lg p-2 text-gray-400 hover:bg-white/10"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="mx-auto mb-5 flex h-52 w-52 items-center justify-center rounded-2xl bg-white p-3">
                      {currentAddress ? (
                        <QRCodeSVG
                          value={currentAddress}
                          size={184}
                          level="H"
                        />
                      ) : (
                        <p className="text-sm text-black">
                          Wallet address unavailable
                        </p>
                      )}
                    </div>

                    <p className="mb-2 text-sm text-gray-400">
                      Your {networkName} wallet address
                    </p>

                    <div className="mb-5 break-all rounded-xl border border-white/10 bg-black/20 p-4 font-mono text-sm text-gray-300">
                      {currentAddress || 'No address available'}
                    </div>

                    <button
                      onClick={() => void copyAddress()}
                      disabled={!currentAddress}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-lime-400 py-3 font-bold text-black hover:bg-lime-300 disabled:opacity-50"
                    >
                      <Copy size={17} />
                      Copy Address
                    </button>

                    <p className="mt-4 text-xs leading-5 text-yellow-500">
                      Only send assets supported by the selected network.
                      Sending assets on the wrong network may result in loss.
                    </p>
                  </div>
                </div>
              )}

              {modal === 'token' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                  <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101611] p-6 shadow-2xl">
                    <div className="mb-6 flex items-center justify-between">
                      <h3 className="text-xl font-bold">Add Custom Token</h3>
                      <button
                        onClick={closeModal}
                        className="rounded-lg p-2 text-gray-400 hover:bg-white/10"
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <p className="mb-5 text-sm leading-6 text-gray-500">
                      Enter the official ERC-20 token contract address
                      on the currently selected EVM network.
                    </p>

                    <label className="mb-2 block text-sm text-gray-400">
                      Token Contract Address
                    </label>

                    <input
                      type="text"
                      value={tokenAddress}
                      onChange={event => setTokenAddress(event.target.value)}
                      placeholder="0x..."
                      className="mb-6 w-full rounded-xl border border-white/10 bg-[#080b09] px-4 py-3 text-sm text-white outline-none focus:border-lime-400"
                    />

                    <button
                      onClick={() => void addEvmToken()}
                      disabled={loading || !tokenAddress}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-lime-400 py-3 font-bold text-black hover:bg-lime-300 disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <RefreshCw size={17} className="animate-spin" />
                          Adding...
                        </>
                      ) : (
                        <>
                          <Plus size={17} />
                          Add Token
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
                          }

                                 
