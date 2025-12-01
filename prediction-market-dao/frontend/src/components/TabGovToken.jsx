import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

function TabGovToken({ govTokenContract, account, onBalanceChange }) {
  const [rate, setRate] = useState('1000'); // 1 ETH = 1000 GOV (default)
  const [buyAmount, setBuyAmount] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Load rate từ contract (nếu có function getRate)
  useEffect(() => {
    loadRate();
  }, [govTokenContract]);

  const loadRate = async () => {
    try {
      // Giả sử contract có function rate() public
      const contractRate = await govTokenContract.rate();
      setRate(contractRate.toString());
    } catch (error) {
      console.log('Using default rate');
      // Nếu không có, dùng default
    }
  };

  // Mua GOV
  const handleBuy = async () => {
    if (!buyAmount || parseFloat(buyAmount) <= 0) {
      alert('Please enter valid ETH amount');
      return;
    }

    try {
      setIsLoading(true);
      const ethValue = ethers.parseEther(buyAmount);

      const tx = await govTokenContract.buyTokens({
        value: ethValue,
      });

      await tx.wait();
      alert('Buy GOV success!');
      setBuyAmount('');
      onBalanceChange();
    } catch (error) {
      console.error('Buy error:', error);
      alert('Buy failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Bán GOV
  const handleSell = async () => {
    if (!sellAmount || parseFloat(sellAmount) <= 0) {
      alert('Please enter valid GOV amount');
      return;
    }

    try {
      setIsLoading(true);
      const govValue = ethers.parseEther(sellAmount);

      const tx = await govTokenContract.sellTokens(govValue);
      await tx.wait();

      alert('Sell GOV success!');
      setSellAmount('');
      onBalanceChange();
    } catch (error) {
      console.error('Sell error:', error);
      alert('Sell failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="tab-gov-token">
      <div className="rate-info">
        <h3>💱 Exchange Rate</h3>
        <p className="rate">1 ETH = {rate} GOV</p>
      </div>

      <div className="trade-section">
        <div className="trade-box buy-box">
          <h4>🟢 Buy GOV</h4>
          <div className="input-group">
            <label>ETH Amount:</label>
            <input
              type="number"
              step="0.001"
              placeholder="0.0"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <p className="estimate">
            ≈ {buyAmount ? (parseFloat(buyAmount) * parseFloat(rate)).toFixed(2) : '0'} GOV
          </p>
          <button
            className="btn-primary"
            onClick={handleBuy}
            disabled={isLoading || !buyAmount}
          >
            {isLoading ? 'Buying...' : 'Buy GOV'}
          </button>
        </div>

        <div className="trade-box sell-box">
          <h4>🔴 Sell GOV</h4>
          <div className="input-group">
            <label>GOV Amount:</label>
            <input
              type="number"
              step="1"
              placeholder="0"
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <p className="estimate">
            ≈ {sellAmount ? (parseFloat(sellAmount) / parseFloat(rate)).toFixed(6) : '0'} ETH
          </p>
          <button
            className="btn-secondary"
            onClick={handleSell}
            disabled={isLoading || !sellAmount}
          >
            {isLoading ? 'Selling...' : 'Sell GOV'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TabGovToken;
