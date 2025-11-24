// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ERC20 token quản trị
contract GovernanceToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("GovToken", "GOV") {
        _mint(msg.sender, initialSupply);
    }
}

/// Prediction Market DAO
contract PredictionMarketDAO {
    struct Market {
        string question;
        uint256 endTime;
        uint256 yesPool;
        uint256 noPool;
        bool resolved;
        bool outcome; // true = YES, false = NO
    }

    struct Proposal {
        string description;
        uint256 marketId; // market liên quan
        bool executeYes;  // true = resolve YES, false = resolve NO
        uint256 votesFor;
        uint256 votesAgainst;
        bool executed;
        uint256 deadline;
        mapping(address => bool) voted;
    }

    GovernanceToken public govToken;
    Market[] public markets;
    Proposal[] public proposals;
    uint256 public proposalDuration = 1 days;

    mapping(uint256 => mapping(address => uint256)) public betsYes;
    mapping(uint256 => mapping(address => uint256)) public betsNo;

    constructor(uint256 initialSupply) {
        govToken = new GovernanceToken(initialSupply);
    }

    // ===== Market Functions =====

    function createMarket(string memory question, uint256 durationSeconds) external {
        markets.push(Market({
            question: question,
            endTime: block.timestamp + durationSeconds,
            yesPool: 0,
            noPool: 0,
            resolved: false,
            outcome: false
        }));
    }

    function placeBetYes(uint256 marketId) external payable {
        require(block.timestamp < markets[marketId].endTime, "Market closed");
        betsYes[marketId][msg.sender] += msg.value;
        markets[marketId].yesPool += msg.value;
    }

    function placeBetNo(uint256 marketId) external payable {
        require(block.timestamp < markets[marketId].endTime, "Market closed");
        betsNo[marketId][msg.sender] += msg.value;
        markets[marketId].noPool += msg.value;
    }

    /// internal function để resolve market (gọi từ executeProposal)
    function resolveMarketInternal(uint256 marketId, bool outcome) internal {
        Market storage m = markets[marketId];
        require(block.timestamp >= m.endTime, "Market not ended");
        require(!m.resolved, "Already resolved");

        m.resolved = true;
        m.outcome = outcome;
    }

    /// optional: public function resolve trực tiếp
    function resolveMarketPublic(uint256 marketId, bool outcome) external {
        resolveMarketInternal(marketId, outcome);
    }

    function withdrawWinnings(uint256 marketId) external {
        Market storage m = markets[marketId];
        require(m.resolved, "Market not resolved");

        uint256 amount = 0;

        if(m.yesPool == 0 && m.noPool == 0) {
            revert("No bets in market");
        }

        if(m.outcome) { // YES wins
            uint256 userBet = betsYes[marketId][msg.sender];
            require(userBet > 0, "No winning");
            if(m.noPool > 0) {
                amount = userBet + (userBet * m.noPool / m.yesPool);
            } else {
                amount = userBet;
            }
            betsYes[marketId][msg.sender] = 0;
        } else { // NO wins
            uint256 userBet = betsNo[marketId][msg.sender];
            require(userBet > 0, "No winning");
            if(m.yesPool > 0) {
                amount = userBet + (userBet * m.yesPool / m.noPool);
            } else {
                amount = userBet;
            }
            betsNo[marketId][msg.sender] = 0;
        }

        payable(msg.sender).transfer(amount);
    }

    function getMarketsCount() external view returns(uint256) {
        return markets.length;
    }

    // ===== DAO Governance =====

    function createProposal(string memory description, uint256 marketId, bool executeYes) external {
        proposals.push();
        Proposal storage p = proposals[proposals.length-1];
        p.description = description;
        p.marketId = marketId;
        p.executeYes = executeYes;
        p.votesFor = 0;
        p.votesAgainst = 0;
        p.executed = false;
        p.deadline = block.timestamp + proposalDuration;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.deadline, "Proposal ended");
        require(!p.voted[msg.sender], "Already voted");

        uint256 weight = govToken.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        if(support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }
        p.voted[msg.sender] = true;
    }

    function executeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp >= p.deadline, "Proposal not ended");
        require(!p.executed, "Already executed");

        if(p.votesFor > p.votesAgainst) {
            resolveMarketInternal(p.marketId, p.executeYes);
        }

        p.executed = true;
    }

    function getProposalsCount() external view returns(uint256) {
        return proposals.length;
    }
}
