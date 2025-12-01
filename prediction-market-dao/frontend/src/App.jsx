import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import Header from './components/Header';
import TabGovToken from './components/TabGovToken';
import TabMarkets from './components/TabMarkets';
import AdminPanel from './components/AdminPanel';
import TabProposals from './components/TabProposals';
import { getContracts } from './utils/contract';
import './App.css';

function App() {
    const [provider, setProvider] = useState(null);
    const [signer, setSigner] = useState(null);
    const [account, setAccount] = useState('');
    const [ethBalance, setEthBalance] = useState('0');
    const [govBalance, setGovBalance] = useState('0');
    const [contracts, setContracts] = useState(null);
    const [activeTab, setActiveTab] = useState('govToken');
    const [isLoading, setIsLoading] = useState(false);
    
    // ✅ THÊM STATE CHO ADMIN
    const [isOwner, setIsOwner] = useState(false);

    // ✅ Dùng ref để tránh stale closure
    const contractsRef = useRef(contracts);
    const providerRef = useRef(provider);

    // ✅ Sync ref khi state thay đổi
    useEffect(() => {
        contractsRef.current = contracts;
        providerRef.current = provider;
    }, [contracts, provider]);

    // ✅ AUTO-RECONNECT khi load page
    useEffect(() => {
        checkConnection();
    }, []);

    // ✅ EVENT LISTENERS - CHỈ SETUP 1 LẦN
    useEffect(() => {
        if (!window.ethereum) return;

        const handleAccountChange = async (accounts) => {
            if (accounts.length === 0) {
                disconnectWallet();
            } else {
                await updateAccountAndSigner();
            }
        };

        const handleChainChange = () => {
            console.log('⛓️ Chain changed, reloading...');
            window.location.reload();
        };

        window.ethereum.on('accountsChanged', handleAccountChange);
        window.ethereum.on('chainChanged', handleChainChange);

        console.log('✅ Event listeners attached');

        return () => {
            console.log('🧹 Cleaning up event listeners');
            if (window.ethereum.removeListener) {
                window.ethereum.removeListener('accountsChanged', handleAccountChange);
                window.ethereum.removeListener('chainChanged', handleChainChange);
            }
        };
    }, []);

    // ✅ HÀM CHECK ADMIN STATUS
    const checkAdminStatus = async (address, daoContract) => {
        try {
            console.log('🔍 Checking admin status for:', address);
            const owner = await daoContract.owner();
            const isAdmin = owner.toLowerCase() === address.toLowerCase();
            
            console.log('👑 Contract owner:', owner);
            console.log('🔐 Is admin:', isAdmin);
            
            setIsOwner(isAdmin);
            return isAdmin;
        } catch (error) {
            console.error('❌ Check admin error:', error);
            setIsOwner(false);
            return false;
        }
    };

    // ✅ HÀM CẬP NHẬT ACCOUNT
    const updateAccountAndSigner = async () => {
        try {
            if (!window.ethereum) {
                console.warn('No MetaMask detected');
                return;
            }

            const newProvider = new ethers.BrowserProvider(window.ethereum);
            const newSigner = await newProvider.getSigner();
            const newAddress = await newSigner.getAddress();

            setProvider(newProvider);
            setSigner(newSigner);
            setAccount(newAddress);

            // ✅ TẠO LẠI CONTRACTS
            const { daoContract, govTokenContract } = await getContracts(newSigner);
            setContracts({ daoContract, govTokenContract });

            // ✅ CHECK ADMIN STATUS
            await checkAdminStatus(newAddress, daoContract);

            // ✅ LOAD BALANCES
            await loadBalances(newAddress, newProvider, govTokenContract);

        } catch (error) {
            console.error('❌ Update account error:', error);
            alert('Failed to update account: ' + error.message);
        }
    };

    // ✅ Kiểm tra connection khi load
    const checkConnection = async () => {
        try {
            if (!window.ethereum) return;

            const accounts = await window.ethereum.request({
                method: 'eth_accounts'
            });

            if (accounts.length > 0) {
                await connectWallet();
            }
        } catch (error) {
            console.error('Check connection error:', error);
        }
    };

    // ✅ Connect wallet
    const connectWallet = async () => {
        setIsLoading(true);
        try {
            if (!window.ethereum) {
                alert('Please install MetaMask!');
                return;
            }

            const accounts = await window.ethereum.request({
                method: "eth_requestAccounts"
            });

            if (accounts.length === 0) {
                alert('No accounts found');
                return;
            }

            const newProvider = new ethers.BrowserProvider(window.ethereum);
            const newSigner = await newProvider.getSigner();
            const address = await newSigner.getAddress();

            console.log('🔌 Connected:', address);

            setProvider(newProvider);
            setSigner(newSigner);
            setAccount(address);

            // Load contracts
            try {
                const { daoContract, govTokenContract } = await getContracts(newSigner);
                setContracts({ daoContract, govTokenContract });
                
                // ✅ CHECK ADMIN STATUS AFTER CONNECTING
                await checkAdminStatus(address, daoContract);
                
                await loadBalances(address, newProvider, govTokenContract);
            } catch (contractError) {
                console.error('Contract error:', contractError);
                alert('Contract not deployed or wrong network.');
                return;
            }
        } catch (error) {
            console.error('Connect wallet error:', error);
            alert('Failed to connect wallet: ' + (error?.message || 'Unknown error'));
        } finally {
            setIsLoading(false);
        }
    };

    // Load balances
    const loadBalances = async (address, provider, govTokenContract) => {
        try {
            const ethBal = await provider.getBalance(address);
            const govBal = await govTokenContract.balanceOf(address);

            setEthBalance(ethers.formatEther(ethBal));
            setGovBalance(ethers.formatEther(govBal));

            console.log('💰 Balances loaded:', {
                eth: ethers.formatEther(ethBal),
                gov: ethers.formatEther(govBal)
            });
        } catch (error) {
            console.error('Load balances error:', error);
        }
    };

    // Refresh balances
    const refreshBalances = async () => {
        if (account && provider && contracts) {
            await loadBalances(account, provider, contracts.govTokenContract);
        }
    };

    // Đăng xuất
    const disconnectWallet = () => {
        console.log('👋 Disconnecting wallet');

        setProvider(null);
        setSigner(null);
        setAccount('');
        setEthBalance('0');
        setGovBalance('0');
        setContracts(null);
        setIsOwner(false); // ✅ RESET ADMIN STATUS
    };

    // ✅ DYNAMIC TABS DỰA TRÊN ADMIN STATUS
    const getTabs = () => {
        const baseTabs = [
            { id: 'govToken', label: 'GOV Token', icon: '🪙' },
            { id: 'markets', label: 'Markets', icon: '🏪' },
            { id: 'proposals', label: 'Proposals', icon: '🗳️' }
        ];

        // ✅ CHỈ THÊM ADMIN TAB NẾU LÀ OWNER
        if (isOwner) {
            baseTabs.push({ id: 'admin', label: 'Admin', icon: '⚙️' });
        }

        return baseTabs;
    };

    const tabs = getTabs();

    return (
        <div className="app">
            <Header
                account={account}
                ethBalance={ethBalance}
                govBalance={govBalance}
                onConnect={connectWallet}
                onDisconnect={disconnectWallet}
                isLoading={isLoading}
                isOwner={isOwner} // ✅ PASS ADMIN STATUS TO HEADER
            />

            {account && contracts && (
                <>
                    {/* ✅ RENDER TABS DYNAMICALLY */}
                    <div className="tabs">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                className={activeTab === tab.id ? 'tab active' : 'tab'}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.icon} {tab.label}
                                {/* ✅ ADMIN BADGE */}
                                {tab.id === 'admin' && (
                                    <span className="admin-badge">👑</span>
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="tab-content">
                        {activeTab === 'govToken' && (
                            <TabGovToken
                                govTokenContract={contracts.govTokenContract}
                                account={account}
                                onBalanceChange={refreshBalances}
                            />
                        )}
                        
                        {activeTab === 'markets' && (
                            <TabMarkets
                                daoContract={contracts.daoContract}
                                govTokenContract={contracts.govTokenContract}
                                account={account}
                                onBalanceChange={refreshBalances}
                            />
                        )}
                        
                        {activeTab === 'proposals' && (
                            <TabProposals
                                daoContract={contracts.daoContract}
                                govTokenContract={contracts.govTokenContract}
                                account={account}
                            />
                        )}
                        
                        {/* ✅ ADMIN PANEL - CHỈ RENDER KHI LÀ OWNER */}
                        {activeTab === 'admin' && isOwner && (
                            <AdminPanel
                                daoContract={contracts.daoContract}
                                govTokenContract={contracts.govTokenContract}
                                account={account}
                                isOwner={isOwner}
                            />
                        )}
                    </div>
                </>
            )}

            {!account && (
                <div className="welcome">
                    <div className="welcome-content">
                        <h1>🔮 Prediction Market DAO</h1>
                        <p>Decentralized prediction markets with governance</p>
                        <div className="welcome-features">
                            <div className="feature">
                                <span className="feature-icon">🏪</span>
                                <span>Create & bet on markets</span>
                            </div>
                            <div className="feature">
                                <span className="feature-icon">🗳️</span>
                                <span>Dispute resolutions</span>
                            </div>
                            <div className="feature">
                                <span className="feature-icon">🪙</span>
                                <span>Earn governance tokens</span>
                            </div>
                        </div>
                        <button 
                            className="btn-primary btn-connect" 
                            onClick={connectWallet}
                            disabled={isLoading}
                        >
                            {isLoading ? 'Connecting...' : '🔌 Connect Wallet'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;