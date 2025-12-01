import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function AdminPanel({ daoContract, govTokenContract, account, isOwner }) {
    const [activeTab, setActiveTab] = useState('overview');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingType, setLoadingType] = useState('');

    // Parameters state
    const [params, setParams] = useState({
        stakingRequirement: '100',
        votingDuration: '604800', // 7 days
        executionDelay: '86400',  // 1 day
        quorumThreshold: '1000',
        slashingRate: '50'
    });

    // Stats state
    const [stats, setStats] = useState({
        totalMarkets: 0,
        totalProposals: 0,
        totalGovSupply: '0',
        totalEthLocked: '0',
        totalUsers: 0
    });

    // Emergency state
    const [emergencyPaused, setEmergencyPaused] = useState(false);
    const [newOwner, setNewOwner] = useState('');

    useEffect(() => {
        if (daoContract && account && isOwner) {
            loadParameters();
            loadStats();
            checkEmergencyStatus();
        }
    }, [daoContract, account, isOwner]);

    const loadParameters = async () => {
        try {
            console.log('📊 Loading parameters...');

            const stakingReq = await daoContract.stakingRequirement();
            const votingDur = await daoContract.votingDuration();
            const execDelay = await daoContract.executionDelay();
            const quorum = await daoContract.quorumThreshold();
            const slashing = await daoContract.slashingRate();

            setParams({
                stakingRequirement: ethers.formatEther(stakingReq),
                votingDuration: votingDur.toString(),
                executionDelay: execDelay.toString(),
                quorumThreshold: ethers.formatEther(quorum),
                slashingRate: slashing.toString()
            });
        } catch (error) {
            console.error('❌ Load parameters error:', error);
        }
    };

    const loadStats = async () => {
        try {
            console.log('📈 Loading stats...');

            // ✅ COUNT MARKETS - LOOP THROUGH UNTIL FIND EMPTY
            const marketsCount = await daoContract.getMarketsCount();
            // while (true) {
            //     try {
            //         const market = await daoContract.markets(marketsCount);
            //         // Check if market exists (has question)
            //         if (!market.question || market.question === '') {
            //             break;
            //         }
            //         marketsCount++;
            //     } catch (error) {
            //         // If reading fails, we've reached the end
            //         break;
            //     }
            // }

            // ✅ COUNT PROPOSALS - LOOP THROUGH UNTIL FIND EMPTY
            // let proposalsCount = 0;
            const proposalsCount = await daoContract.getProposalsCount();
            // while (true) {
            //     try {
            //         const proposal = await daoContract.proposals(proposalsCount);
            //         // Check if proposal exists (has deadline)
            //         if (proposal.deadline.toString() === '0') {
            //             break;
            //         }
            //         proposalsCount++;
            //     } catch (error) {
            //         // If reading fails, we've reached the end
            //         break;
            //     }
            // }

            // ✅ GET GOV TOKEN SUPPLY
            const govSupply = await govTokenContract.totalSupply();

            // ✅ GET CONTRACT ETH BALANCE
            const contractAddress = await daoContract.getAddress();
            const ethBalance = await daoContract.runner.provider.getBalance(contractAddress);

            // ✅ COUNT UNIQUE USERS (ESTIMATE FROM EVENTS)
            let totalUsers = 0;
            try {
                // Try to get Transfer events from GOV token to estimate users
                const filter = govTokenContract.filters.Transfer();
                const events = await govTokenContract.queryFilter(filter, -10000); // Last 10k blocks
                const uniqueUsers = new Set();

                events.forEach(event => {
                    if (event.args.to && event.args.to !== ethers.ZeroAddress) {
                        uniqueUsers.add(event.args.to.toLowerCase());
                    }
                    if (event.args.from && event.args.from !== ethers.ZeroAddress) {
                        uniqueUsers.add(event.args.from.toLowerCase());
                    }
                });

                totalUsers = uniqueUsers.size;
            } catch (eventError) {
                console.warn('Could not count users from events:', eventError);
                totalUsers = 0;
            }

            console.log('📊 Stats loaded:', {
                markets: marketsCount,
                proposals: proposalsCount,
                govSupply: ethers.formatEther(govSupply),
                ethBalance: ethers.formatEther(ethBalance),
                users: totalUsers
            });

            setStats({
                totalMarkets: marketsCount,
                totalProposals: proposalsCount,
                totalGovSupply: ethers.formatEther(govSupply),
                totalEthLocked: ethers.formatEther(ethBalance),
                totalUsers: totalUsers
            });

        } catch (error) {
            console.error('❌ Load stats error:', error);

            // ✅ SET DEFAULT VALUES IF FAILED
            setStats({
                totalMarkets: 0,
                totalProposals: 0,
                totalGovSupply: '0',
                totalEthLocked: '0',
                totalUsers: 0
            });
        }
    };

    const checkEmergencyStatus = async () => {
        try {
            const paused = await daoContract.emergencyPaused();
            setEmergencyPaused(paused);
        } catch (error) {
            console.error('❌ Check emergency status error:', error);
        }
    };

    const handleUpdateParameter = async (paramName, value) => {
        try {
            setIsLoading(true);
            setLoadingType(paramName);

            let tx;
            switch (paramName) {
                case 'stakingRequirement':
                    tx = await daoContract.setStakingRequirement(ethers.parseEther(value));
                    break;
                case 'votingDuration':
                    tx = await daoContract.setVotingDuration(parseInt(value));
                    break;
                case 'executionDelay':
                    tx = await daoContract.setExecutionDelay(parseInt(value));
                    break;
                case 'quorumThreshold':
                    tx = await daoContract.setQuorumThreshold(ethers.parseEther(value));
                    break;
                case 'slashingRate':
                    tx = await daoContract.setSlashingRate(parseInt(value));
                    break;
                default:
                    throw new Error('Invalid parameter');
            }

            await tx.wait();
            alert(`✅ ${paramName} updated successfully!`);
            loadParameters();
        } catch (error) {
            console.error('❌ Update parameter error:', error);
            alert('❌ Failed: ' + (error.reason || error.message));
        } finally {
            setIsLoading(false);
            setLoadingType('');
        }
    };

    const handleEmergencyToggle = async () => {
        try {
            setIsLoading(true);
            setLoadingType('emergency');

            const tx = emergencyPaused
                ? await daoContract.unpause()
                : await daoContract.pause();

            await tx.wait();

            setEmergencyPaused(!emergencyPaused);
            alert(`✅ Emergency ${emergencyPaused ? 'disabled' : 'enabled'} successfully!`);
        } catch (error) {
            console.error('❌ Emergency toggle error:', error);
            alert('❌ Failed: ' + (error.reason || error.message));
        } finally {
            setIsLoading(false);
            setLoadingType('');
        }
    };

    const handleTransferOwnership = async () => {
        if (!ethers.isAddress(newOwner)) {
            alert('❌ Invalid address');
            return;
        }

        try {
            setIsLoading(true);
            setLoadingType('transfer');

            const tx = await daoContract.transferOwnership(newOwner);
            await tx.wait();

            alert('✅ Ownership transferred successfully!');
            setNewOwner('');
        } catch (error) {
            console.error('❌ Transfer ownership error:', error);
            alert('❌ Failed: ' + (error.reason || error.message));
        } finally {
            setIsLoading(false);
            setLoadingType('');
        }
    };

    const handleWithdrawFees = async () => {
        try {
            setIsLoading(true);
            setLoadingType('withdraw');

            const tx = await daoContract.withdrawFees();
            await tx.wait();

            alert('✅ Fees withdrawn successfully!');
            loadStats();
        } catch (error) {
            console.error('❌ Withdraw fees error:', error);
            alert('❌ Failed: ' + (error.reason || error.message));
        } finally {
            setIsLoading(false);
            setLoadingType('');
        }
    };

    if (!isOwner) {
        return (
            <div className="admin-panel">
                <div className="access-denied">
                    <div className="access-denied-content">
                        <h2>🚫 Access Denied</h2>
                        <p>Only the contract owner can access the admin panel.</p>
                        <p>Current account: <code>{account}</code></p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-panel">
            {/* SIDEBAR */}
            <div className="admin-sidebar">
                <div className="admin-logo">
                    <h2>⚙️ Admin Panel</h2>
                    <p>Contract Management</p>
                </div>

                <nav className="admin-nav">
                    <button
                        className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                        onClick={() => setActiveTab('overview')}
                    >
                        <span className="nav-icon">📊</span>
                        <span className="nav-text">Overview</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'parameters' ? 'active' : ''}`}
                        onClick={() => setActiveTab('parameters')}
                    >
                        <span className="nav-icon">⚙️</span>
                        <span className="nav-text">Parameters</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'emergency' ? 'active' : ''}`}
                        onClick={() => setActiveTab('emergency')}
                    >
                        <span className="nav-icon">🚨</span>
                        <span className="nav-text">Emergency</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'ownership' ? 'active' : ''}`}
                        onClick={() => setActiveTab('ownership')}
                    >
                        <span className="nav-icon">👑</span>
                        <span className="nav-text">Ownership</span>
                    </button>

                    <button
                        className={`nav-item ${activeTab === 'finance' ? 'active' : ''}`}
                        onClick={() => setActiveTab('finance')}
                    >
                        <span className="nav-icon">💰</span>
                        <span className="nav-text">Finance</span>
                    </button>
                </nav>
            </div>

            {/* MAIN CONTENT */}
            <div className="admin-content">
                {activeTab === 'overview' && (
                    <div className="tab-content">
                        <div className="content-header">
                            <h1>📊 System Overview</h1>
                            <button className="btn-refresh" onClick={() => { loadStats(); loadParameters(); }}>
                                🔄 Refresh
                            </button>
                        </div>

                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-icon">🏪</div>
                                <div className="stat-content">
                                    <h3>{stats.totalMarkets}</h3>
                                    <p>Total Markets</p>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">📋</div>
                                <div className="stat-content">
                                    <h3>{stats.totalProposals}</h3>
                                    <p>Total Proposals</p>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">🪙</div>
                                <div className="stat-content">
                                    <h3>{parseFloat(stats.totalGovSupply).toLocaleString()}</h3>
                                    <p>GOV Supply</p>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon">💎</div>
                                <div className="stat-content">
                                    <h3>{parseFloat(stats.totalEthLocked).toFixed(2)} ETH</h3>
                                    <p>ETH Locked</p>
                                </div>
                            </div>
                        </div>

                        <div className="system-status">
                            <h2>🔍 System Status</h2>
                            <div className="status-grid">
                                <div className="status-item">
                                    <span className="status-label">Emergency Status:</span>
                                    <span className={`status-badge ${emergencyPaused ? 'paused' : 'active'}`}>
                                        {emergencyPaused ? '🔴 PAUSED' : '🟢 ACTIVE'}
                                    </span>
                                </div>

                                <div className="status-item">
                                    <span className="status-label">Contract Owner:</span>
                                    <span className="status-value">{account}</span>
                                </div>

                                <div className="status-item">
                                    <span className="status-label">Staking Requirement:</span>
                                    <span className="status-value">{params.stakingRequirement} GOV</span>
                                </div>

                                <div className="status-item">
                                    <span className="status-label">Voting Duration:</span>
                                    <span className="status-value">{Math.floor(params.votingDuration / 86400)} days</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'parameters' && (
                    <div className="tab-content">
                        <div className="content-header">
                            <h1>⚙️ System Parameters</h1>
                            <p>Configure core protocol parameters</p>
                        </div>

                        <div className="parameters-grid">
                            <div className="parameter-card">
                                <div className="parameter-header">
                                    <h3>🏦 Staking Requirement</h3>
                                    <p>GOV tokens required to create markets</p>
                                </div>
                                <div className="parameter-input">
                                    <input
                                        type="number"
                                        value={params.stakingRequirement}
                                        onChange={(e) => setParams({ ...params, stakingRequirement: e.target.value })}
                                        disabled={isLoading}
                                        step="1"
                                        min="0"
                                    />
                                    <span className="input-suffix">GOV</span>
                                </div>
                                <button
                                    className={`btn-update ${isLoading && loadingType === 'stakingRequirement' ? 'loading' : ''}`}
                                    onClick={() => handleUpdateParameter('stakingRequirement', params.stakingRequirement)}
                                    disabled={isLoading}
                                >
                                    {isLoading && loadingType === 'stakingRequirement' ? '' : 'Update'}
                                </button>
                            </div>

                            <div className="parameter-card">
                                <div className="parameter-header">
                                    <h3>🗳️ Voting Duration</h3>
                                    <p>Time limit for proposal voting (seconds)</p>
                                </div>
                                <div className="parameter-input">
                                    <input
                                        type="number"
                                        value={params.votingDuration}
                                        onChange={(e) => setParams({ ...params, votingDuration: e.target.value })}
                                        disabled={isLoading}
                                        step="3600"
                                        min="3600"
                                    />
                                    <span className="input-suffix">sec</span>
                                </div>
                                <div className="parameter-helper">
                                    ≈ {Math.floor(params.votingDuration / 86400)} days {Math.floor((params.votingDuration % 86400) / 3600)} hours
                                </div>
                                <button
                                    className={`btn-update ${isLoading && loadingType === 'votingDuration' ? 'loading' : ''}`}
                                    onClick={() => handleUpdateParameter('votingDuration', params.votingDuration)}
                                    disabled={isLoading}
                                >
                                    {isLoading && loadingType === 'votingDuration' ? '' : 'Update'}
                                </button>
                            </div>

                            <div className="parameter-card">
                                <div className="parameter-header">
                                    <h3>⏱️ Execution Delay</h3>
                                    <p>Delay before proposal execution (seconds)</p>
                                </div>
                                <div className="parameter-input">
                                    <input
                                        type="number"
                                        value={params.executionDelay}
                                        onChange={(e) => setParams({ ...params, executionDelay: e.target.value })}
                                        disabled={isLoading}
                                        step="3600"
                                        min="0"
                                    />
                                    <span className="input-suffix">sec</span>
                                </div>
                                <div className="parameter-helper">
                                    ≈ {Math.floor(params.executionDelay / 86400)} days {Math.floor((params.executionDelay % 86400) / 3600)} hours
                                </div>
                                <button
                                    className={`btn-update ${isLoading && loadingType === 'executionDelay' ? 'loading' : ''}`}
                                    onClick={() => handleUpdateParameter('executionDelay', params.executionDelay)}
                                    disabled={isLoading}
                                >
                                    {isLoading && loadingType === 'executionDelay' ? '' : 'Update'}
                                </button>
                            </div>

                            <div className="parameter-card">
                                <div className="parameter-header">
                                    <h3>📊 Quorum Threshold</h3>
                                    <p>Minimum votes required for proposals</p>
                                </div>
                                <div className="parameter-input">
                                    <input
                                        type="number"
                                        value={params.quorumThreshold}
                                        onChange={(e) => setParams({ ...params, quorumThreshold: e.target.value })}
                                        disabled={isLoading}
                                        step="1"
                                        min="0"
                                    />
                                    <span className="input-suffix">GOV</span>
                                </div>
                                <button
                                    className={`btn-update ${isLoading && loadingType === 'quorumThreshold' ? 'loading' : ''}`}
                                    onClick={() => handleUpdateParameter('quorumThreshold', params.quorumThreshold)}
                                    disabled={isLoading}
                                >
                                    {isLoading && loadingType === 'quorumThreshold' ? '' : 'Update'}
                                </button>
                            </div>

                            <div className="parameter-card">
                                <div className="parameter-header">
                                    <h3>⚔️ Slashing Rate</h3>
                                    <p>Penalty percentage for wrong resolutions</p>
                                </div>
                                <div className="parameter-input">
                                    <input
                                        type="number"
                                        value={params.slashingRate}
                                        onChange={(e) => setParams({ ...params, slashingRate: e.target.value })}
                                        disabled={isLoading}
                                        step="1"
                                        min="0"
                                        max="100"
                                    />
                                    <span className="input-suffix">%</span>
                                </div>
                                <button
                                    className={`btn-update ${isLoading && loadingType === 'slashingRate' ? 'loading' : ''}`}
                                    onClick={() => handleUpdateParameter('slashingRate', params.slashingRate)}
                                    disabled={isLoading}
                                >
                                    {isLoading && loadingType === 'slashingRate' ? '' : 'Update'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'emergency' && (
                    <div className="tab-content">
                        <div className="content-header">
                            <h1>🚨 Emergency Controls</h1>
                            <p>Critical system controls for emergency situations</p>
                        </div>

                        <div className="emergency-section">
                            <div className="emergency-card">
                                <div className="emergency-header">
                                    <h3>⏸️ Emergency Pause</h3>
                                    <div className={`status-indicator ${emergencyPaused ? 'paused' : 'active'}`}>
                                        {emergencyPaused ? '🔴 PAUSED' : '🟢 ACTIVE'}
                                    </div>
                                </div>

                                <p className="emergency-description">
                                    {emergencyPaused
                                        ? 'The system is currently paused. All critical functions are disabled.'
                                        : 'The system is running normally. All functions are available.'
                                    }
                                </p>

                                <div className="emergency-warning">
                                    <p>⚠️ <strong>Warning:</strong> Emergency pause will disable:</p>
                                    <ul>
                                        <li>Market creation and betting</li>
                                        <li>Proposal creation and voting</li>
                                        <li>Token minting and burning</li>
                                        <li>Market resolution</li>
                                    </ul>
                                </div>

                                <button
                                    className={`btn-emergency ${isLoading && loadingType === 'emergency' ? 'loading' : ''} ${emergencyPaused ? 'resume' : 'pause'}`}
                                    onClick={handleEmergencyToggle}
                                    disabled={isLoading}
                                >
                                    {isLoading && loadingType === 'emergency'
                                        ? ''
                                        : emergencyPaused
                                            ? '▶️ Resume System'
                                            : '⏸️ Emergency Pause'
                                    }
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'ownership' && (
                    <div className="tab-content">
                        <div className="content-header">
                            <h1>👑 Ownership Management</h1>
                            <p>Transfer contract ownership to another address</p>
                        </div>

                        <div className="ownership-section">
                            <div className="ownership-card">
                                <div className="ownership-header">
                                    <h3>🔐 Current Owner</h3>
                                </div>

                                <div className="current-owner">
                                    <div className="owner-info">
                                        <span className="owner-label">Address:</span>
                                        <code className="owner-address">{account}</code>
                                    </div>
                                </div>

                                <div className="transfer-section">
                                    <h4>📤 Transfer Ownership</h4>
                                    <p className="transfer-warning">
                                        ⚠️ <strong>Danger:</strong> This action is irreversible. You will lose admin access.
                                    </p>

                                    <div className="transfer-input">
                                        <label>New Owner Address:</label>
                                        <input
                                            type="text"
                                            placeholder="0x..."
                                            value={newOwner}
                                            onChange={(e) => setNewOwner(e.target.value)}
                                            disabled={isLoading}
                                        />
                                    </div>

                                    <button
                                        className={`btn-danger ${isLoading && loadingType === 'transfer' ? 'loading' : ''}`}
                                        onClick={handleTransferOwnership}
                                        disabled={isLoading || !newOwner}
                                    >
                                        {isLoading && loadingType === 'transfer' ? '' : '👑 Transfer Ownership'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'finance' && (
                    <div className="tab-content">
                        <div className="content-header">
                            <h1>💰 Financial Management</h1>
                            <p>Manage protocol fees and treasury</p>
                        </div>

                        <div className="finance-section">
                            <div className="finance-overview">
                                <h3>💎 Treasury Balance</h3>
                                <div className="balance-display">
                                    <span className="balance-amount">{parseFloat(stats.totalEthLocked).toFixed(4)} ETH</span>
                                    <span className="balance-usd">≈ ${(parseFloat(stats.totalEthLocked) * 3000).toLocaleString()} USD</span>
                                </div>
                            </div>

                            <div className="finance-actions">
                                <div className="finance-card">
                                    <div className="finance-header">
                                        <h3>💸 Withdraw Fees</h3>
                                    </div>

                                    <p className="finance-description">
                                        Withdraw accumulated protocol fees from resolved markets and penalties.
                                    </p>

                                    <div className="fee-info">
                                        <p>📊 Estimated fees: <strong>0.05 ETH</strong></p>
                                        <p>🏦 Last withdrawal: Never</p>
                                    </div>

                                    <button
                                        className={`btn-success ${isLoading && loadingType === 'withdraw' ? 'loading' : ''}`}
                                        onClick={handleWithdrawFees}
                                        disabled={isLoading}
                                    >
                                        {isLoading && loadingType === 'withdraw' ? '' : '💰 Withdraw Fees'}
                                    </button>
                                </div>

                                <div className="finance-card">
                                    <div className="finance-header">
                                        <h3>📈 Protocol Revenue</h3>
                                    </div>

                                    <div className="revenue-stats">
                                        <div className="revenue-item">
                                            <span className="revenue-label">Market Creation Fees:</span>
                                            <span className="revenue-value">0.12 ETH</span>
                                        </div>
                                        <div className="revenue-item">
                                            <span className="revenue-label">Slashing Penalties:</span>
                                            <span className="revenue-value">0.08 ETH</span>
                                        </div>
                                        <div className="revenue-item">
                                            <span className="revenue-label">Trading Fees:</span>
                                            <span className="revenue-value">0.15 ETH</span>
                                        </div>
                                        <div className="revenue-total">
                                            <span className="revenue-label">Total Revenue:</span>
                                            <span className="revenue-value">0.35 ETH</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default AdminPanel;