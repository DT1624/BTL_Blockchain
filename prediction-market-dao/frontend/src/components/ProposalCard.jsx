import React from 'react';
import dayjs from 'dayjs';

function ProposalCard({ proposal, market, onClick }) {
  const now = Date.now() / 1000;
  const isActive = now < proposal.deadline && !proposal.executed;
  const isExpired = now >= proposal.deadline && !proposal.executed;
  const isExecuted = proposal.executed;

  const getStatus = () => {
    if (isExecuted) {
      return { label: 'Executed ✅', className: 'status-executed' };
    }
    if (isExpired) {
      return { label: 'Ready to Execute ⏳', className: 'status-expired' };
    }
    return { label: 'Voting Active 🗳️', className: 'status-active' };
  };

  const formatTimeLeft = () => {
    if (isExecuted) return 'Completed';
    if (isExpired) return 'Voting Ended';
    
    const timeLeft = proposal.deadline - now;
    const days = Math.floor(timeLeft / 86400);
    const hours = Math.floor((timeLeft % 86400) / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  };

  const status = getStatus();
  const totalVotes = parseFloat(proposal.votesFor) + parseFloat(proposal.votesAgainst);

  return (
    <div className={`proposal-card ${status.className}`} onClick={onClick}>
      <div className="proposal-header">
        <h4>Proposal #{proposal.id}</h4>
        <span className={`status-badge ${status.className}`}>{status.label}</span>
      </div>

      <div className="description">
        {proposal.description}
      </div>

      <div className="proposal-info">
        <div className="info-row">
          <span className="label">Market:</span>
          <span className="value">#{proposal.marketID}: {market?.question || 'Unknown'}</span>
        </div>

        <div className="info-row">
          <span className="label">Current Outcome:</span>
          <span className="value">{market?.outcome ? 'YES ✅' : 'NO ❌'}</span>
        </div>

        <div className="info-row">
          <span className="label">Proposed Change:</span>
          <span className="value">{proposal.executeYES ? 'YES ✅' : 'NO ❌'}</span>
        </div>

        <div className="info-row">
          <span className="label">Time Status:</span>
          <span className="value">{formatTimeLeft()}</span>
        </div>

        <div className="info-row">
          <span className="label">Deadline:</span>
          <span className="value">
            {dayjs(proposal.deadline * 1000).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        </div>
      </div>

      <div className="vote-stats">
        <div className="vote-stat">
          <div className="label">👍 For</div>
          <div className="value">{parseFloat(proposal.votesFor).toFixed(2)}</div>
        </div>
        <div className="vote-stat">
          <div className="label">👎 Against</div>
          <div className="value">{parseFloat(proposal.votesAgainst).toFixed(2)}</div>
        </div>
      </div>

      {proposal.myVotePower !== '0.0' && (
        <div style={{ 
          marginTop: '1rem', 
          textAlign: 'center', 
          fontSize: '0.9rem', 
          color: '#667eea',
          fontWeight: '600',
          background: 'rgba(102, 126, 234, 0.1)',
          padding: '0.5rem',
          borderRadius: '8px'
        }}>
          ✅ You voted with {parseFloat(proposal.myVotePower).toFixed(2)} voting power
        </div>
      )}

      <button className="btn-view">View Details →</button>
    </div>
  );
}

export default ProposalCard;