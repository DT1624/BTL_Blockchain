import React from 'react';

function Header({ account, ethBalance, govBalance, onConnect, onDisconnect, isLoading }) {
    const formatAddress = (addr) => {
        if (!addr) return '';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    };

    return (
        <header className="header">
            <div className="header-left">
                <h2>🔮 Prediction Market DAO</h2>
            </div>

            <div className="header-right">
                {account ? (
                    <div className="wallet-container">
                        {/* ✅ BALANCES với viền đẹp */}
                        <div className="wallet-balances">
                            <div className="balance-card">
                                <span className="balance-label">💎ETH</span>
                                <span className="balance-value">
                                    {Number(ethBalance).toLocaleString('en-US', {
                                        minimumFractionDigits: 4,
                                        maximumFractionDigits: 4
                                    })}
                                </span>
                            </div>

                            <div className="balance-card">
                                <span className="balance-label">🪙GOV</span>
                                <span className="balance-value">
                                    {Number(govBalance).toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    })}
                                </span>
                            </div>
                        </div>

                        {/* ✅ ACCOUNT INFO rõ ràng */}
                        <div className="account-section">
                            <div className="account-address">
                                <span className="address-icon">👤</span>
                                <span className="address-text">{formatAddress(account)}</span>
                            </div>
                            <button className="btn-disconnect" onClick={onDisconnect}>
                                Disconnect
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        className="btn-connect"
                        onClick={onConnect}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Connecting...' : 'Connect Wallet'}
                    </button>
                )}
            </div>
        </header>
    );
}

export default Header;