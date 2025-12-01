import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import dayjs from 'dayjs';


function MarketDetail({ market, daoContract, govTokenContract, account, onClose, onUpdate }) {
  const [betSide, setBetSide] = useState(true); // true = YES, false = NO
  const [betAmount, setBetAmount] = useState('');
  const [resolveOutcome, setResolveOutcome] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const MIN_RESOLVER_BOND = ethers.parseEther('50');
  const now = Date.now() / 1000;
  const canBet = now < market.endTime && !market.bettingClosed;
  const canResolve = now >= market.endTime && !market.resolved;
  const canWithdraw = market.resolved;

  // Place Bet
  const handlePlaceBet = async () => {
    if (!betAmount || parseFloat(betAmount) <= 0) {
      alert('Please enter valid bet amount');
      return;
    }

    try {
      setIsLoading(true);
      const ethValue = ethers.parseEther(betAmount);

      const tx = await daoContract.placeBet(market.id, betSide, {
        value: ethValue,
      });

      await tx.wait();
      alert('Bet placed successfully!');
      setBetAmount('');
      onUpdate();
    } catch (error) {
      console.error('Place bet error:', error);
      alert('Failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Resolve Market
  const handleResolve = async () => {
    try {
      setIsLoading(true);

      // Check GOV balance
      const govBal = await govTokenContract.balanceOf(account);
      if (govBal < MIN_RESOLVER_BOND) {
        alert(`Need ${ethers.formatEther(MIN_RESOLVER_BOND)} GOV to resolve`);
        return;
      }

      // Approve
      const allowance = await govTokenContract.allowance(account, daoContract.target);
      if (allowance < MIN_RESOLVER_BOND) {
        const approveTx = await govTokenContract.approve(
          daoContract.target,
          MIN_RESOLVER_BOND
        );
        await approveTx.wait();
      }

      // Resolve
      const tx = await daoContract.resolveMarket(market.id, resolveOutcome);
      await tx.wait();

      alert('Market resolved successfully!');
      onUpdate();
    } catch (error) {
      console.error('Resolve error:', error);
      alert('Failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Withdraw Winnings
  const handleWithdraw = async () => {
    if (parseFloat(market.myBetYES) === 0 && parseFloat(market.myBetNO) === 0) {
      alert('You have no bets in this market');
      return;
    }

    try {
      setIsLoading(true);

      const tx = await daoContract.withdrawWinnings(market.id);
      await tx.wait();

      alert('Withdrawal successful!');
      onUpdate();
    } catch (error) {
      console.error('Withdraw error:', error);
      alert('Failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Market #{market.id}</h3>
          <button className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="question-section">
            <h4>📝 Question:</h4>
            <p className="question-text">{market.question}</p>
          </div>

          <div className="info-grid">
            <div className="info-item">
              <span className="label">Deadline:</span>
              <span className="value">
                {dayjs(market.endTime * 1000).format('YYYY-MM-DD HH:mm:ss')}
              </span>
            </div>

            <div className="info-item">
              <span className="label">Status:</span>
              <span className="value">
                {market.resolved
                  ? `Resolved: ${market.outcome ? 'YES ✅' : 'NO ❌'}`
                  : canBet
                  ? 'Active 🟢'
                  : 'Waiting Resolve ⏳'}
              </span>
            </div>

            <div className="info-item">
              <span className="label">My YES Bet:</span>
              <span className="value">{parseFloat(market.myBetYES).toFixed(4)} ETH</span>
            </div>

            <div className="info-item">
              <span className="label">My NO Bet:</span>
              <span className="value">{parseFloat(market.myBetNO).toFixed(4)} ETH</span>
            </div>
          </div>

          {/* BET SECTION */}
          {canBet && (
            <div className="action-section bet-section">
              <h4>💰 Place Bet</h4>
              <div className="bet-options">
                <button
                  className={betSide ? 'btn-bet active' : 'btn-bet'}
                  onClick={() => setBetSide(true)}
                >
                  YES 🟢
                </button>
                <button
                  className={!betSide ? 'btn-bet active' : 'btn-bet'}
                  onClick={() => setBetSide(false)}
                >
                  NO 🔴
                </button>
              </div>
              <div className="input-group">
                <label>Amount (ETH):</label>
                <input
                  type="number"
                  step="0.001"
                  placeholder="0.0"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <button
                className="btn-primary"
                onClick={handlePlaceBet}
                disabled={isLoading || !betAmount}
              >
                {isLoading ? 'Placing...' : `Bet ${betSide ? 'YES' : 'NO'}`}
              </button>
            </div>
          )}

          {/* RESOLVE SECTION */}
          {canResolve && (
            <div className="action-section resolve-section">
              <h4>⚖️ Resolve Market (Stake 50 GOV)</h4>
              <div className="resolve-options">
                <button
                  className={resolveOutcome ? 'btn-resolve active' : 'btn-resolve'}
                  onClick={() => setResolveOutcome(true)}
                >
                  Resolve YES ✅
                </button>
                <button
                  className={!resolveOutcome ? 'btn-resolve active' : 'btn-resolve'}
                  onClick={() => setResolveOutcome(false)}
                >
                  Resolve NO ❌
                </button>
              </div>
              <button
                className="btn-secondary"
                onClick={handleResolve}
                disabled={isLoading}
              >
                {isLoading ? 'Resolving...' : 'Resolve Market'}
              </button>
            </div>
          )}

          {/* WITHDRAW SECTION */}
          {canWithdraw && (
            <div className="action-section withdraw-section">
              <h4>💸 Withdraw Winnings</h4>
              <p className="info-text">
                Outcome: {market.outcome ? 'YES ✅' : 'NO ❌'}
              </p>
              <button
                className="btn-success"
                onClick={handleWithdraw}
                disabled={isLoading}
              >
                {isLoading ? 'Withdrawing...' : 'Withdraw My Winnings'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MarketDetail;