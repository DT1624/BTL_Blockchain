import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import ProposalCard from './ProposalCard';
import ProposalDetail from './ProposalDetail';

function TabProposals({ daoContract, govTokenContract, account }) {
  const [proposals, setProposals] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);

  useEffect(() => {
    if (daoContract && account) {
      loadProposals();
      loadMarkets();
    }
  }, [daoContract, account]);

  const loadProposals = async () => {
    try {
      console.log('📋 Loading proposals...');
      const proposalsData = [];
      let proposalId = 0;

      while (true) {
        try {
          const proposal = await daoContract.proposals(proposalId);
          
          if (proposal.deadline.toString() === '0') {
            break;
          }

          const myVote = await daoContract.usedVotingPower(proposalId, account);

          proposalsData.push({
            id: proposalId,
            description: proposal.description,
            marketID: Number(proposal.marketID),
            executeYES: proposal.executeYES,
            deadline: Number(proposal.deadline),
            votesFor: ethers.formatEther(proposal.votesFor),
            votesAgainst: ethers.formatEther(proposal.votesAgainst),
            executed: proposal.executed,
            myVotePower: ethers.formatEther(myVote),
          });

          proposalId++;
        } catch (error) {
          console.log(`Stopped at proposal ${proposalId} (not found)`);
          break;
        }
      }

      console.log(`✅ Loaded ${proposalsData.length} proposals:`, proposalsData);
      setProposals(proposalsData);
    } catch (error) {
      console.error('❌ Load proposals error:', error);
      setProposals([]);
    }
  };

  const loadMarkets = async () => {
    try {
      console.log('📊 Loading markets...');
      const count = await daoContract.getMarketsCount();
      const marketsData = [];

      for (let i = 0; i < count; i++) {
        const market = await daoContract.markets(i);
        marketsData.push({
          id: i,
          question: market.question,
          resolved: market.resolved,
          outcome: market.outcome,
          bettingClosed: market.bettingClosed,
          endTime: Number(market.endTime),
        });
      }

      console.log('✅ Loaded markets:', marketsData);
      setMarkets(marketsData);
    } catch (error) {
      console.error('❌ Load markets error:', error);
    }
  };

  const handleCreateProposal = async () => {
    if (!selectedMarketId) {
      alert('❌ Please select a market');
      return;
    }

    const marketId = parseInt(selectedMarketId);
    const market = markets.find((m) => m.id === marketId);

    if (!market) {
      alert('❌ Invalid market');
      return;
    }

    if (!market.resolved) {
      alert('❌ Market must be resolved first');
      return;
    }

    if (!description.trim()) {
      alert('❌ Please enter description');
      return;
    }

    try {
      setIsLoading(true);
      const proposedOutcome = !market.outcome;

      console.log('Creating proposal:', {
        description,
        marketId,
        proposedOutcome,
        currentOutcome: market.outcome,
      });

      const tx = await daoContract.createDisputeProposal(
        description,
        marketId,
        proposedOutcome
      );

      console.log('📤 Transaction sent:', tx.hash);
      await tx.wait();
      console.log('✅ Transaction confirmed!');

      alert('✅ Dispute proposal created successfully!');

      setDescription('');
      setSelectedMarketId('');

      setTimeout(() => {
        loadProposals();
      }, 2000);

    } catch (error) {
      console.error('❌ Create proposal error:', error);
      alert('❌ Failed: ' + (error.reason || error.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const resolvedMarkets = markets.filter((m) => m.resolved);

  const handleProposalUpdate = () => {
    loadProposals();
    setSelectedProposal(null);
  };

  return (
    <div className="tab-proposals">
      {/* CREATE PROPOSAL SECTION */}
      <div className="create-proposal-section">
        <h3>⚡ Create Dispute Proposal</h3>

        <div className="form-group">
          <label>Select Resolved Market:</label>
          <select
            value={selectedMarketId}
            onChange={(e) => setSelectedMarketId(e.target.value)}
            disabled={isLoading}
          >
            <option value="">-- Select Market --</option>
            {resolvedMarkets.map((market) => (
              <option key={market.id} value={market.id}>
                #{market.id}: {market.question} (Outcome: {market.outcome ? 'YES' : 'NO'})
              </option>
            ))}
          </select>
        </div>

        {selectedMarketId && (
          <div className="info-box">
            <p>
              ℹ️ Current outcome:{' '}
              <strong>
                {markets.find((m) => m.id === parseInt(selectedMarketId))?.outcome
                  ? 'YES'
                  : 'NO'}
              </strong>
            </p>
            <p>Your proposal will suggest the opposite outcome.</p>
          </div>
        )}

        <div className="form-group">
          <label>Description / Reason:</label>
          <textarea
            placeholder="Why do you think the resolver was wrong? Provide evidence or reasoning..."
            rows="4"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <button
          className={`btn-primary ${isLoading ? 'loading' : ''}`}
          onClick={handleCreateProposal}
          disabled={isLoading || !selectedMarketId || !description.trim()}
        >
          {isLoading ? '' : 'Create Dispute Proposal'}
        </button>
      </div>

      {/* PROPOSALS LIST */}
      <div className="proposals-list">
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '1.5rem' 
        }}>
          <h3>📋 All Proposals ({proposals.length})</h3>
          <button
            className="btn-secondary"
            onClick={loadProposals}
            disabled={isLoading}
            style={{ 
              padding: '0.75rem 1.5rem', 
              fontSize: '0.9rem',
              borderRadius: '8px'
            }}
          >
            🔄 Refresh
          </button>
        </div>

        {proposals.length === 0 ? (
          <div className="empty">
            <p>📭 No proposals yet</p>
            <small>Create a dispute proposal for a resolved market</small>
          </div>
        ) : (
          proposals
            .sort((a, b) => b.id - a.id)
            .map((proposal) => {
              const market = markets.find((m) => m.id === proposal.marketID);
              return (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  market={market}
                  onClick={() => setSelectedProposal(proposal)}
                />
              );
            })
        )}
      </div>

      {/* PROPOSAL DETAIL MODAL */}
      {selectedProposal && (
        <ProposalDetail
          proposal={selectedProposal}
          market={markets.find((m) => m.id === selectedProposal.marketID)}
          daoContract={daoContract}
          govTokenContract={govTokenContract}
          account={account}
          onClose={() => setSelectedProposal(null)}
          onUpdate={handleProposalUpdate}
        />
      )}
    </div>
  );
}

export default TabProposals;