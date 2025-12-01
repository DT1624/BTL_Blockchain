import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import dayjs from 'dayjs';

function ProposalDetail({ proposal, market, daoContract, govTokenContract, account, onClose, onUpdate }) {
  const [voteSupport, setVoteSupport] = useState(true);
  const [voteAmount, setVoteAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingType, setLoadingType] = useState('');
  const [myVotingPower, setMyVotingPower] = useState('0');
  const [remainingPower, setRemainingPower] = useState('0');

  const now = Date.now() / 1000;
  const canVote = now < proposal.deadline && !proposal.executed;
  const canExecute = now >= proposal.deadline && !proposal.executed;

  useEffect(() => {
    loadVotingPower();
  }, []);

  const loadVotingPower = async () => {
    try {
      const marketData = await daoContract.markets(proposal.marketID);
      const snapshotBlock = marketData.snapshotBlock;

      const totalPower = await govTokenContract.getPastVotes(account, snapshotBlock);
      const usedPower = await daoContract.usedVotingPower(proposal.id, account);

      setMyVotingPower(ethers.formatEther(totalPower));
      setRemainingPower(ethers.formatEther(totalPower - usedPower));
    } catch (error) {
      console.error('Load voting power error:', error);
    }
  };

  const handleVote = async () => {
    if (!voteAmount || parseFloat(voteAmount) <= 0) {
      alert('Please enter valid vote amount');
      return;
    }

    if (parseFloat(voteAmount) > parseFloat(remainingPower)) {
      alert('Insufficient voting power');
      return;
    }

    try {
      setIsLoading(true);
      setLoadingType('vote');
      const amount = ethers.parseEther(voteAmount);

      const tx = await daoContract.vote(proposal.id, voteSupport, amount);
      await tx.wait();

      alert('Vote submitted successfully!');
      setVoteAmount('');
      loadVotingPower();
      onUpdate();
    } catch (error) {
      console.error('Vote error:', error);
      alert('Failed: ' + error.message);
    } finally {
      setIsLoading(false);
      setLoadingType('');
    }
  };

  const handleExecute = async () => {
    try {
      setIsLoading(true);
      setLoadingType('execute');

      const tx = await daoContract.executeProposal(proposal.id);
      await tx.wait();

      alert('Proposal executed successfully!');
      onUpdate();
    } catch (error) {
      console.error('Execute error:', error);
      alert('Failed: ' + error.message);
    } finally {
      setIsLoading(false);
      setLoadingType('');
    }
  };

  const totalVotes = parseFloat(proposal.votesFor) + parseFloat(proposal.votesAgainst);
  const forPercentage = totalVotes > 0 ? (parseFloat(proposal.votesFor) / totalVotes * 100) : 0;
  const againstPercentage = totalVotes > 0 ? (parseFloat(proposal.votesAgainst) / totalVotes * 100) : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content proposal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Proposal #{proposal.id}</h3>
          <button className="btn-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="description-section">
            <h4>📝 Description:</h4>
            <p className="description-text">{proposal.description}</p>
          </div>

          <div className="info-grid">
            <div className="info-item">
              <span className="label">Related Market:</span>
              <span className="value">#{proposal.marketID}: {market?.question}</span>
            </div>

            <div className="info-item">
              <span className="label">Current Outcome:</span>
              <span className="value">{market?.outcome ? 'YES ✅' : 'NO ❌'}</span>
            </div>

            <div className="info-item">
              <span className="label">Proposed Change To:</span>
              <span className="value">{proposal.executeYES ? 'YES ✅' : 'NO ❌'}</span>
            </div>

            <div className="info-item">
              <span className="label">Voting Deadline:</span>
              <span className="value">
                {dayjs(proposal.deadline * 1000).format('YYYY-MM-DD HH:mm:ss')}
              </span>
            </div>

            <div className="info-item">
              <span className="label">Status:</span>
              <span className="value">
                {proposal.executed
                  ? 'Executed ✅'
                  : canVote
                  ? 'Voting Active 🗳️'
                  : 'Ready to Execute ⏳'}
              </span>
            </div>

            <div className="info-item">
              <span className="label">Time Left:</span>
              <span className="value">
                {canVote
                  ? `${Math.floor((proposal.deadline - now) / 3600)}h ${Math.floor(((proposal.deadline - now) % 3600) / 60)}m`
                  : proposal.executed
                  ? 'Closed'
                  : 'Expired'}
              </span>
            </div>
          </div>

          {/* VOTING STATS */}
          <div className="voting-stats">
            <h4>📊 Voting Results</h4>
            
            <div className="vote-bar">
              <div className="vote-label">
                <span>FOR (Support Dispute)</span>
                <span>{parseFloat(proposal.votesFor).toFixed(2)} GOV ({forPercentage.toFixed(1)}%)</span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill for" 
                  style={{ width: `${forPercentage}%` }}
                ></div>
              </div>
            </div>

            <div className="vote-bar">
              <div className="vote-label">
                <span>AGAINST (Keep Current)</span>
                <span>{parseFloat(proposal.votesAgainst).toFixed(2)} GOV ({againstPercentage.toFixed(1)}%)</span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill against" 
                  style={{ width: `${againstPercentage}%` }}
                ></div>
              </div>
            </div>

            <div className="my-voting-power">
              <p>💪 My Voting Power: {parseFloat(myVotingPower).toFixed(2)} GOV</p>
              <p>✅ Remaining Power: {parseFloat(remainingPower).toFixed(2)} GOV</p>
              <p>📝 Already Used: {parseFloat(proposal.myVotePower).toFixed(2)} GOV</p>
            </div>
          </div>

          {/* VOTE SECTION */}
          {canVote && parseFloat(remainingPower) > 0 && (
            <div className="action-section vote-section">
              <h4>🗳️ Cast Your Vote</h4>
              
              <div className="vote-options">
                <button
                  className={voteSupport ? 'btn-vote active for' : 'btn-vote for'}
                  onClick={() => setVoteSupport(true)}
                >
                  FOR (Change to {proposal.executeYES ? 'YES' : 'NO'}) ✅
                </button>
                <button
                  className={!voteSupport ? 'btn-vote active against' : 'btn-vote against'}
                  onClick={() => setVoteSupport(false)}
                >
                  AGAINST (Keep {market?.outcome ? 'YES' : 'NO'}) ❌
                </button>
              </div>

              <div className="input-group">
                <label>Voting Power (GOV):</label>
                <input
                  type="number"
                  step="1"
                  placeholder="0"
                  max={remainingPower}
                  value={voteAmount}
                  onChange={(e) => setVoteAmount(e.target.value)}
                  disabled={isLoading}
                />
                <small>Max: {parseFloat(remainingPower).toFixed(2)} GOV</small>
              </div>

              <button
                className={`btn-success ${isLoading && loadingType === 'vote' ? 'loading' : ''}`}
                onClick={handleVote}
                disabled={isLoading || !voteAmount}
              >
                {isLoading && loadingType === 'vote' ? '' : `Vote ${voteSupport ? 'FOR' : 'AGAINST'}`}
              </button>
            </div>
          )}

          {/* NO VOTING POWER */}
          {canVote && parseFloat(remainingPower) === 0 && (
            <div className="info-box warning">
              <p>⚠️ You have no remaining voting power for this proposal.</p>
              {parseFloat(myVotingPower) === 0 && (
                <p>You didn't hold GOV tokens at the snapshot block.</p>
              )}
            </div>
          )}

          {/* EXECUTE SECTION */}
          {canExecute && (
            <div className="action-section execute-section">
              <h4>⚡ Execute Proposal</h4>
              <p className="info-text">
                Voting has ended. Anyone can execute this proposal.
              </p>
              <div className="result-preview">
                {parseFloat(proposal.votesFor) > parseFloat(proposal.votesAgainst) ? (
                  <p className="result-pass">
                    ✅ Dispute PASSED: Outcome will change to{' '}
                    <strong>{proposal.executeYES ? 'YES' : 'NO'}</strong>
                    <br />
                    Resolver will be slashed 50%.
                  </p>
                ) : (
                  <p className="result-fail">
                    ❌ Dispute FAILED: Outcome stays{' '}
                    <strong>{market?.outcome ? 'YES' : 'NO'}</strong>
                    <br />
                    Resolver will be rewarded.
                  </p>
                )}
              </div>
              <button
                className={`btn-secondary ${isLoading && loadingType === 'execute' ? 'loading' : ''}`}
                onClick={handleExecute}
                disabled={isLoading}
              >
                {isLoading && loadingType === 'execute' ? '' : 'Execute Proposal'}
              </button>
            </div>
          )}

          {/* EXECUTED */}
          {proposal.executed && (
            <div className="info-box success">
              <p>✅ This proposal has been executed.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProposalDetail;