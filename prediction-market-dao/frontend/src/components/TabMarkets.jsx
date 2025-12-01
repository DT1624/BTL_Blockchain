import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import MarketCard from './MarketCard';
import MarketDetail from './MarketDetail';

function TabMarkets({ daoContract, govTokenContract, account, onBalanceChange }) {
  const [markets, setMarkets] = useState([]);
  const [question, setQuestion] = useState('');
  const [duration, setDuration] = useState('86400'); // 1 day default
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const MIN_CREATOR_BOND = ethers.parseEther('100');

  useEffect(() => {
    loadMarkets();
  }, [daoContract, account]);

  const loadMarkets = async () => {
    try {
      const count = await daoContract.getMarketsCount();
      const marketsData = [];

      for (let i = 0; i < count; i++) {
        const market = await daoContract.markets(i);
        const myBetYES = await daoContract.betsYES(i, account);
        const myBetNO = await daoContract.betsNO(i, account);

        marketsData.push({
          id: i,
          question: market.question,
          endTime: Number(market.endTime),
          resolved: market.resolved,
          outcome: market.outcome,
          bettingClosed: market.bettingClosed,
          myBetYES: ethers.formatEther(myBetYES),
          myBetNO: ethers.formatEther(myBetNO),
          poolYES: ethers.formatEther(market.poolYES),
          poolNO: ethers.formatEther(market.poolNO),
        });
      }

      setMarkets(marketsData);
    } catch (error) {
      console.error('Load markets error:', error);
    }
  };

  const handleCreateMarket = async () => {
    if (!question.trim()) {
      alert('Please enter question');
      return;
    }

    if (!duration || parseInt(duration) <= 0) {
      alert('Please enter valid duration');
      return;
    }

    try {
      setIsLoading(true);

      // Check GOV balance
      const govBal = await govTokenContract.balanceOf(account);
      if (govBal < MIN_CREATOR_BOND) {
        alert(`Need ${ethers.formatEther(MIN_CREATOR_BOND)} GOV to create market`);
        return;
      }

      // Approve
      const allowance = await govTokenContract.allowance(account, daoContract.target);
      if (allowance < MIN_CREATOR_BOND) {
        const approveTx = await govTokenContract.approve(daoContract.target, MIN_CREATOR_BOND);
        await approveTx.wait();
      }

      // Create market
      const tx = await daoContract.createMarket(question, parseInt(duration));
      await tx.wait();

      alert('Market created successfully!');
      setQuestion('');
      setDuration('86400');
      loadMarkets();
      onBalanceChange();
    } catch (error) {
      console.error('Create market error:', error);
      alert('Failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="tab-markets">
      <div className="create-market-section">
        <h3>➕ Create New Market</h3>
        <div className="form-group">
          <label>Question:</label>
          <input
            type="text"
            placeholder="ETH > $5000 by Dec 31, 2025?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isLoading}
          />
        </div>
        <div className="form-group">
          <label>Duration (seconds):</label>
          <input
            type="number"
            placeholder="86400"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            disabled={isLoading}
          />
          <small>Default: 3600s (1h) | 86400s (1 day) | 604800s (7 days)</small>
        </div>
        <button
          className="btn-primary"
          onClick={handleCreateMarket}
          disabled={isLoading}
        >
          {isLoading ? 'Creating...' : 'Create Market (Stake 100 GOV)'}
        </button>
      </div>

      <div className="markets-list">
        <h3>📋 All Markets</h3>
        {markets.length === 0 ? (
          <p className="empty">No markets yet</p>
        ) : (
          markets.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              onClick={() => setSelectedMarket(market)}
            />
          ))
        )}
      </div>

      {selectedMarket && (
        <MarketDetail
          market={selectedMarket}
          daoContract={daoContract}
          govTokenContract={govTokenContract}
          account={account}
          onClose={() => setSelectedMarket(null)}
          onUpdate={() => {
            loadMarkets();
            onBalanceChange();
          }}
        />
      )}
    </div>
  );
}

export default TabMarkets;