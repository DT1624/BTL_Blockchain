import React from 'react';
import dayjs from 'dayjs';

function MarketCard({ market, onClick }) {
  const now = Date.now() / 1000;
  const isActive = now < market.endTime && !market.bettingClosed;
  const isExpired = now >= market.endTime && !market.resolved;
  const isResolved = market.resolved;

  const getStatus = () => {
    if (isResolved) {
      return {
        label: market.outcome ? 'Resolved: YES ✅' : 'Resolved: NO ❌',
        className: 'status-resolved',
      };
    }
    if (isExpired) {
      return { label: 'Waiting Resolve ⏳', className: 'status-expired' };
    }
    return { label: 'Active 🟢', className: 'status-active' };
  };

  const status = getStatus();

  return (
    <div className={`market-card ${status.className}`} onClick={onClick}>
      <div className="market-header">
        <h4>#{market.id}: {market.question}</h4>
        <span className={`status-badge ${status.className}`}>{status.label}</span>
      </div>

      <div className="market-info">
        <div className="info-row">
          <span className="label">Deadline:</span>
          <span className="value">
            {dayjs(market.endTime * 1000).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        </div>

        <div className="info-row">
          <span className="label">My Bets:</span>
          <div className="bet-amounts">
            <span className="bet-yes">YES: {parseFloat(market.myBetYES).toFixed(4)} ETH</span>
            <span className="bet-no">NO: {parseFloat(market.myBetNO).toFixed(4)} ETH</span>
          </div>
        </div>

        <div className="info-row">
          <span className="label">Time Left:</span>
          <span className="value">
            {isActive
              ? `${Math.floor((market.endTime - now) / 86400)}d ${Math.floor(((market.endTime - now) % 86400) / 3600)}h`
              : isExpired
              ? 'Expired'
              : 'Closed'}
          </span>
        </div>
      </div>

      <button className="btn-view">View Details →</button>
    </div>
  );
}

export default MarketCard;