// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./GovernanceToken.sol";

// ✅ FIX: Remove duplicate ReentrancyGuard
contract PredictionMarketDAO is Ownable, Pausable, ReentrancyGuard {
    // struct
    struct Market {
        string question; // câu hỏi đặt cược của Market
        address creator; // người tạo market
        uint256 creatorBond; // số tiền đặt cọc của người tạo market
        uint256 endTime; // thời điểm kết thúc đặt cược
        uint256 resolveDeadline; // thời điểm cuối cùng cho phép resolve market
        uint256 poolYES; // tổng tiền cược cho YES
        uint256 poolNO; // tổng tiền cược cho NO
        bool resolved; // câu hỏi đã được giải quyết thông qua proposal chưa
        bool outcome; // kết quả chung cuộc (true = YES, false = NO)
        address resolver; // địa chỉ người resolve market
        uint256 resolverBond; // số tiền đặt cọc của resolver
        uint256 resolveTime; // thời điểm market được resolve (đảm bảo <= resolveDeadline)
        uint256 disputeDeadline; // thời gian tranh chấp sau khi resolve được thực thi (được phép tạo proposal)
        uint256 relatedProposalId; // proposalID liên quan tới market này
        uint256 snapshotBlock; // block snapshot khi đóng bet
        bool bettingClosed; // trạng thái bet đã đóng chưa
        bool bondReturned; // trạng thái bond đã được trả lại cho creator market chưa
        bool resolverPaid; // trạng thái resolver đã được trả tiền chưa
    }

    struct Proposal {
        string description; // mô tả về proposal
        uint256 marketID; // ID của market đang tương tác
        bool executeYES; // kết quả chung cuộc mà proposal đề xuất để bỏ phiếu
        uint256 votesFor; // tổng trọng số phiếu ủng hộ
        uint256 votesAgainst; // tổng trọng số phiếu phản đối
        uint256 deadline; // thời điểm kết thúc cho việc bỏ phiếu
        bool executed; // trạng thái được thực thi của proposal
        address proposer;
        uint256 snapshotBlock; // block number sẽ dùng cho getPastVotes
    }

    // ========== STATE VARIABLES ==========
    GovernanceToken public govToken;
    Market[] public markets;
    Proposal[] public proposals;

    // ✅ ADMIN PARAMETERS (Configurable thay cho constants)
    uint256 public stakingRequirement = 100 ether; // MIN_CREATOR_BOND
    uint256 public resolverBond = 50 ether; // MIN_RESOLVER_BOND
    uint256 public resolveWindowDuration = 12 hours; // RESOLVE_WINDOW_DURATION
    uint256 public disputeWindow = 1 days; // DISPUTE_WINDOW
    uint256 public votingDuration = 1 days; // PROPOSAL_VOTING_DURATION
    uint256 public resolverRewardBps = 100; // RESOLVER_REWARD_BPS (1%)
    uint256 public resolverSlashBps = 5000; // RESOLVER_SLASH_BPS (50%)
    uint256 public constant BPS_DENOM = 10000;

    uint256 public defaultProposalId = type(uint256).max; // giá trị đặc biệt cho biết market không có proposal liên quan

    //Mappings
    mapping(uint256 => mapping(address => uint256)) public betsYES; // Số ETH đặt cược YES của mỗi địa chỉ cho mỗi market
    mapping(uint256 => mapping(address => uint256)) public betsNO; // Số ETH đặt cược NO của mỗi địa chỉ cho mỗi market
    mapping(uint256 => mapping(address => bool)) public hasVoted; // Theo dõi xem người dùng đã vote cho proposal chưa
    mapping(address => bool) public executors;

    // Configurable parameters
    uint256 public feeBps = 200; // default fee 2% (chia cho 100)
    uint256 public soloBonusRate = 500; // nếu tất cả thắng, trích 5% từ tổng quỹ
    uint256 public returnFeeBps = 8000; // nếu thua thì trả lại 80% số tiền - 20% nạp vào quỹ
    uint256 public vaultBalance; // Tổng số dư của vault (ETH)

    // ✅ ADMIN EVENTS
    event ParameterUpdated(
        string indexed parameter,
        uint256 oldValue,
        uint256 newValue
    );
    event EmergencyPaused(address indexed admin);
    event EmergencyUnpaused(address indexed admin);
    event FeesWithdrawn(address indexed admin, uint256 amount);

    // ========== EVENTS ==========
    event MarketCreated(
        uint256 indexed id,
        string question,
        uint256 endTime,
        address indexed creator,
        uint256 bond
    );
    event MarketBettingClosed(uint256 indexed marketID, uint256 snapshotBlock);
    event PlaceBet(
        uint256 indexed marketID,
        address indexed user,
        bool onYES,
        uint256 amount
    );
    event MarketResolved(
        uint256 indexed marketID,
        bool outcome,
        address indexed resolver,
        uint256 bond
    );
    event ProposalCreated(
        uint256 indexed proposalID,
        uint256 indexed marketID,
        bool executeYES,
        address indexed proposer
    );
    event Voted(
        uint256 proposalID,
        address indexed voter,
        bool support,
        uint256 weight
    );
    event ProposalExecuted(
        uint256 indexed proposalID,
        bool passed,
        address indexed executor
    );
    event ResolverRewarded(
        uint256 indexed marketID,
        address indexed resolver,
        uint256 bondReturned,
        uint256 reward
    );
    event ResolverSlashed(
        uint256 indexed marketID,
        address indexed resolver,
        uint256 slashed
    );
    event CreatorBondReturned(
        uint256 indexed marketID,
        address indexed creator,
        uint256 bond
    );
    event Withdrawn(
        address indexed user,
        uint256 indexed marketID,
        uint256 amount,
        uint256 fee
    );
    event VaultWithdrawn(address indexed to, uint256 amount);
    event ExecutorUpdated(address indexed executor, bool status);
    event Received(address indexed sender, uint256 amount);

    // ========== MODIFIERS ==========
    // Tự động đóng cược nếu đã hết thời gian đặt cược (sử dụng trong resolveMarket và createDisputeProposal)
    modifier autoCloseBetting(uint256 marketID) {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        if (!m.bettingClosed && block.timestamp >= m.endTime) {
            m.bettingClosed = true;
            m.snapshotBlock = block.number;
            emit MarketBettingClosed(marketID, m.snapshotBlock);
        }
        _;
    }

    modifier autoFinalizeResolve(uint256 marketID) {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(m.resolved, "Market not resolved");
        if (!m.resolverPaid && m.resolver != address(0)) {
            bool hasActiveDispute = (m.relatedProposalId != defaultProposalId &&
                !proposals[m.relatedProposalId].executed);

            if (!hasActiveDispute) {
                _rewardResolver(marketID);
            }
        }

        if (!m.bondReturned) {
            _returnCreatorBond(marketID);
        }
        _;
    }

    // ========== CONSTRUCTOR ==========
    constructor(uint256 initialSupply) Ownable(msg.sender) {
        govToken = new GovernanceToken(initialSupply);
        executors[msg.sender] = true;
    }

    // ✅ ADMIN FUNCTIONS - PARAMETER MANAGEMENT
    function setStakingRequirement(
        uint256 _stakingRequirement
    ) external onlyOwner {
        require(
            _stakingRequirement > 0,
            "Staking requirement must be positive"
        );
        uint256 oldValue = stakingRequirement;
        stakingRequirement = _stakingRequirement;
        emit ParameterUpdated(
            "stakingRequirement",
            oldValue,
            _stakingRequirement
        );
    }

    function setResolverBond(uint256 _resolverBond) external onlyOwner {
        require(_resolverBond > 0, "Resolver bond must be positive");
        uint256 oldValue = resolverBond;
        resolverBond = _resolverBond;
        emit ParameterUpdated("resolverBond", oldValue, _resolverBond);
    }

    function setVotingDuration(uint256 _votingDuration) external onlyOwner {
        require(_votingDuration >= 1 minutes, "Voting duration too short");
        require(_votingDuration <= 10 days, "Voting duration too long");
        uint256 oldValue = votingDuration;
        votingDuration = _votingDuration;
        emit ParameterUpdated("votingDuration", oldValue, _votingDuration);
    }

    function setResolveWindowDuration(
        uint256 _resolveWindowDuration
    ) external onlyOwner {
        require(_resolveWindowDuration >= 1 hours, "Resolve window too short");
        require(_resolveWindowDuration <= 7 days, "Resolve window too long");
        uint256 oldValue = resolveWindowDuration;
        resolveWindowDuration = _resolveWindowDuration;
        emit ParameterUpdated(
            "resolveWindowDuration",
            oldValue,
            _resolveWindowDuration
        );
    }

    function setDisputeWindow(uint256 _disputeWindow) external onlyOwner {
        require(_disputeWindow >= 12 hours, "Dispute window too short");
        require(_disputeWindow <= 14 days, "Dispute window too long");
        uint256 oldValue = disputeWindow;
        disputeWindow = _disputeWindow;
        emit ParameterUpdated("disputeWindow", oldValue, _disputeWindow);
    }

    function setResolverRewardBps(
        uint256 _resolverRewardBps
    ) external onlyOwner {
        require(_resolverRewardBps <= 1000, "Resolver reward too high"); // Max 10%
        uint256 oldValue = resolverRewardBps;
        resolverRewardBps = _resolverRewardBps;
        emit ParameterUpdated(
            "resolverRewardBps",
            oldValue,
            _resolverRewardBps
        );
    }

    function setResolverSlashBps(uint256 _resolverSlashBps) external onlyOwner {
        require(_resolverSlashBps <= BPS_DENOM, "Invalid slash rate");
        uint256 oldValue = resolverSlashBps;
        resolverSlashBps = _resolverSlashBps;
        emit ParameterUpdated("resolverSlashBps", oldValue, _resolverSlashBps);
    }

    // ✅ EMERGENCY FUNCTIONS
    function pause() public onlyOwner {
        _pause();
        emit EmergencyPaused(msg.sender);
    }

    function unpause() public onlyOwner {
        _unpause();
        emit EmergencyUnpaused(msg.sender);
    }

    function emergencyPaused() external view returns (bool) {
        return paused();
    }

    // ✅ FINANCIAL MANAGEMENT
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 balance = vaultBalance;
        require(balance > 0, "No fees to withdraw");

        vaultBalance = 0;
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");

        emit FeesWithdrawn(msg.sender, balance);
    }

    function emergencyWithdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");

        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Emergency withdrawal failed");

        emit FeesWithdrawn(msg.sender, balance);
    }

    function _updateVault(uint256 amount) internal {
        vaultBalance += amount;
        emit Received(msg.sender, amount);
    }

    // cho phép contract nhận ETH trực tiếp mà không cần đi kèm call data (đảm bảo an toàn cho tests/funding)
    receive() external payable {
        _updateVault(msg.value);
    }

    fallback() external payable {
        _updateVault(msg.value);
    }

    // ========== MARKET FUNCTIONS WITH PAUSABLE ==========
    function createMarket(
        string calldata question,
        uint256 durationTime
    ) external whenNotPaused {
        require(durationTime > 0, "Duration must be > 0");

        // ✅ Use configurable stakingRequirement
        require(
            govToken.balanceOf(msg.sender) >= stakingRequirement,
            "Insufficient GOV for creator bond"
        );
        require(
            govToken.transferFrom(
                msg.sender,
                address(this),
                stakingRequirement
            ),
            "Creator bond transfer failed"
        );

        uint256 _endTime = block.timestamp + durationTime;
        uint256 _resolveDeadline = _endTime + resolveWindowDuration; // ✅ Use configurable

        markets.push(
            Market({
                question: question,
                creator: msg.sender,
                creatorBond: stakingRequirement, // ✅ Use configurable
                endTime: _endTime,
                resolveDeadline: _resolveDeadline,
                poolYES: 0,
                poolNO: 0,
                resolved: false,
                outcome: false,
                resolver: address(0),
                resolverBond: 0,
                resolveTime: 0,
                disputeDeadline: 0,
                relatedProposalId: defaultProposalId,
                snapshotBlock: 0,
                bettingClosed: false,
                bondReturned: false,
                resolverPaid: false
            })
        );
        emit MarketCreated(
            markets.length - 1,
            question,
            _endTime,
            msg.sender,
            stakingRequirement // ✅ Use configurable
        );
    }

    function placeBet(
        uint256 marketID,
        bool onYES
    ) external payable whenNotPaused {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(block.timestamp < m.endTime, "Market closed");
        require(msg.value > 0, "Invalid amount");
        if (onYES) {
            betsYES[marketID][msg.sender] += msg.value;
            m.poolYES += msg.value;
        } else {
            betsNO[marketID][msg.sender] += msg.value;
            m.poolNO += msg.value;
        }
        emit PlaceBet(marketID, msg.sender, onYES, msg.value);
    }

    function resolveMarket(
        uint256 marketID,
        bool outcome
    ) external whenNotPaused autoCloseBetting(marketID) {
        Market storage m = markets[marketID];
        require(
            block.timestamp <= m.resolveDeadline,
            "Resolve window has passed"
        );
        require(m.bettingClosed, "Betting not closed");
        require(!m.resolved, "Already resolved");

        // ✅ Use configurable resolverBond
        require(
            govToken.balanceOf(msg.sender) >= resolverBond,
            "Insufficient GOV for resolver bond"
        );
        require(
            govToken.transferFrom(msg.sender, address(this), resolverBond),
            "Resolver bond transfer failed"
        );

        m.resolved = true;
        m.outcome = outcome;
        m.resolver = msg.sender;
        m.resolverBond = resolverBond; // ✅ Use configurable
        m.resolveTime = block.timestamp;
        m.disputeDeadline = block.timestamp + disputeWindow; // ✅ Use configurable

        emit MarketResolved(marketID, outcome, msg.sender, resolverBond);
    }

    function createDisputeProposal(
        string calldata description,
        uint256 marketID,
        bool correctOutcome
    ) external whenNotPaused autoCloseBetting(marketID) {
        Market storage m = markets[marketID];

        require(m.resolved, "Market not resolved yet");
        require(block.timestamp <= m.disputeDeadline, "Dispute window closed");
        require(
            m.relatedProposalId == defaultProposalId,
            "Market already has dispute"
        );
        require(
            correctOutcome != m.outcome,
            "Proposal must disagree with resolver"
        );

        uint256 deadline = block.timestamp + votingDuration; // ✅ Use configurable
        m.relatedProposalId = proposals.length;

        proposals.push(
            Proposal({
                description: description,
                marketID: marketID,
                executeYES: correctOutcome,
                votesFor: 0,
                votesAgainst: 0,
                deadline: deadline,
                executed: false,
                proposer: msg.sender,
                snapshotBlock: m.snapshotBlock
            })
        );

        emit ProposalCreated(
            proposals.length - 1,
            marketID,
            correctOutcome,
            msg.sender
        );
    }

    function vote(uint256 proposalID, bool support) external whenNotPaused {
        require(proposalID < proposals.length, "Invalid proposal");
        Proposal storage p = proposals[proposalID];
        require(block.timestamp < p.deadline, "Voting closed");
        require(!hasVoted[proposalID][msg.sender], "Already voted");

        uint256 totalPower = govToken.getPastVotes(msg.sender, p.snapshotBlock);
        require(totalPower > 0, "No voting power");

        if (support) {
            p.votesFor += totalPower;
        } else {
            p.votesAgainst += totalPower;
        }
        hasVoted[proposalID][msg.sender] = true;

        emit Voted(proposalID, msg.sender, support, totalPower);
    }

    function executeProposal(
        uint256 proposalID
    ) external whenNotPaused nonReentrant {
        require(executors[msg.sender], "Not authorized executor");
        require(proposalID < proposals.length, "Invalid proposal");
        Proposal storage p = proposals[proposalID];
        require(block.timestamp >= p.deadline, "Voting not finished");
        require(!p.executed, "Already executed");

        Market storage m = markets[p.marketID];

        bool disputePassed = p.votesFor > p.votesAgainst;

        if (disputePassed) {
            // Dispute wins: resolver was WRONG
            m.outcome = p.executeYES;

            uint256 slashed = (m.resolverBond * resolverSlashBps) / BPS_DENOM; // ✅ Use configurable
            uint256 returnToResolver = m.resolverBond - slashed;
            require(
                govToken.balanceOf(address(this)) >= returnToResolver,
                "Insufficient vault balance"
            );

            if (returnToResolver > 0) {
                require(
                    govToken.transfer(m.resolver, returnToResolver),
                    "Resolver partial return failed"
                );
            }

            m.resolverPaid = true;
            emit ResolverSlashed(p.marketID, m.resolver, slashed);
        } else {
            // Dispute fails: resolver was CORRECT
            _rewardResolver(p.marketID);
        }

        _returnCreatorBond(p.marketID);

        p.executed = true;
        m.relatedProposalId = defaultProposalId;
        emit ProposalExecuted(proposalID, disputePassed, msg.sender);
    }

    // ========== REST OF FUNCTIONS (unchanged) ==========
    function finalizeResolve(uint256 marketID) external whenNotPaused nonReentrant {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(m.resolved, "Not resolved yet");
        require(block.timestamp >= m.disputeDeadline, "Dispute window open");
        require(m.relatedProposalId == defaultProposalId, "Has active dispute");
        require(!m.resolverPaid, "Resolver already paid");

        _rewardResolver(marketID);
        _returnCreatorBond(marketID);
    }

    function _rewardResolver(uint256 marketID) internal {
        Market storage m = markets[marketID];
        if (m.resolverPaid) return;

        uint256 totalPool = m.poolYES + m.poolNO;
        uint256 reward = (totalPool * resolverRewardBps) / BPS_DENOM; // ✅ Use configurable

        // Return bond
        if (m.resolverBond > 0) {
            require(
                m.resolverBond < govToken.balanceOf(address(this)) &&
                    govToken.transfer(m.resolver, m.resolverBond),
                "Resolver bond return failed"
            );
        }

        // Pay ETH reward
        if (reward > 0 && address(this).balance >= reward) {
            (bool ok, ) = payable(m.resolver).call{value: reward}("");
            require(ok, "Resolver reward failed");
        }

        m.resolverPaid = true;
        emit ResolverRewarded(marketID, m.resolver, m.resolverBond, reward);
    }

    function _returnCreatorBond(uint256 marketID) internal {
        Market storage m = markets[marketID];
        if (m.bondReturned || m.creatorBond == 0) return;

        require(
            m.creatorBond < govToken.balanceOf(address(this)) &&
                govToken.transfer(m.creator, m.creatorBond),
            "Creator bond return failed"
        );
        m.bondReturned = true;

        emit CreatorBondReturned(marketID, m.creator, m.creatorBond);
    }

    function withdrawWinnings(
        uint256 marketID
    ) external whenNotPaused autoFinalizeResolve(marketID) nonReentrant {
        Market storage m = markets[marketID];

        uint256 userWinner;
        uint256 userLoser;
        uint256 winnerPool;
        uint256 loserPool;

        if (m.outcome) {
            userWinner = betsYES[marketID][msg.sender];
            userLoser = betsNO[marketID][msg.sender];
            winnerPool = m.poolYES;
            loserPool = m.poolNO;
        } else {
            userWinner = betsNO[marketID][msg.sender];
            userLoser = betsYES[marketID][msg.sender];
            winnerPool = m.poolNO;
            loserPool = m.poolYES;
        }

        require(userWinner > 0 || userLoser > 0, "No bets in this market");
        require(
            address(this).balance >= winnerPool + loserPool,
            "Insufficient total balance"
        );

        uint256 payout = 0;
        uint256 fee = 0;

        // Loser side: 80% refund
        if (userLoser > 0) {
            uint256 returnAmount = (userLoser * returnFeeBps) / BPS_DENOM;
            uint256 loserFee = userLoser - returnAmount;
            payout += returnAmount;
            fee += loserFee;
        }

        // Winner side
        if (userWinner > 0) {
            if (loserPool > 0) {
                // Has loser pool
                uint256 shareFromLoser = (userWinner * loserPool) / winnerPool;
                uint256 grossPayout = userWinner + shareFromLoser;
                uint256 winnerFee = (grossPayout * feeBps) / BPS_DENOM;
                payout += grossPayout - winnerFee;
                fee += winnerFee;
            } else {
                // Solo case: no loser pool
                uint256 defaultFee = (userWinner * feeBps) / BPS_DENOM;
                uint256 soloBonus = 0;

                if (vaultBalance > 0 && winnerPool > 0) {
                    uint256 maxBonus = (vaultBalance * soloBonusRate) /
                        BPS_DENOM;
                    uint256 userBonus = (userWinner * maxBonus) / winnerPool;

                    soloBonus = userBonus < vaultBalance
                        ? userBonus
                        : vaultBalance;
                }
                payout += userWinner - defaultFee + soloBonus;
                fee += defaultFee;
                if (soloBonus > 0) {
                    vaultBalance -= soloBonus;
                }
            }
        }

        require(payout > 0, "No payout calculated");
        require(
            address(this).balance >= payout,
            "Insufficient contract balance"
        );

        betsYES[marketID][msg.sender] = 0;
        betsNO[marketID][msg.sender] = 0;
        vaultBalance += fee;

        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        require(sent, "Transfer failed");

        emit Withdrawn(msg.sender, marketID, payout, fee);
    }

    // ========== ADMIN FUNCTIONS (Enhanced) ==========
    function setExecutor(address executor, bool status) external onlyOwner {
        executors[executor] = status;
        emit ExecutorUpdated(executor, status);
    }

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= BPS_DENOM, "Invalid fee");
        uint256 oldValue = feeBps;
        feeBps = newFeeBps;
        emit ParameterUpdated("feeBps", oldValue, newFeeBps);
    }

    function setSoloBonusRate(uint256 newSoloBonusRate) external onlyOwner {
        require(newSoloBonusRate <= BPS_DENOM, "Invalid rate");
        uint256 oldValue = soloBonusRate;
        soloBonusRate = newSoloBonusRate;
        emit ParameterUpdated("soloBonusRate", oldValue, newSoloBonusRate);
    }

    function setReturnFeeBps(uint256 newReturnFeeBps) external onlyOwner {
        require(newReturnFeeBps <= BPS_DENOM, "Invalid fee");
        uint256 oldValue = returnFeeBps;
        returnFeeBps = newReturnFeeBps;
        emit ParameterUpdated("returnFeeBps", oldValue, newReturnFeeBps);
    }

    function withdrawVault(
        address payable to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        require(amount <= vaultBalance, "Insufficient vault");
        vaultBalance -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Vault transfer failed");
        emit VaultWithdrawn(to, amount);
    }

    // ========== VIEW FUNCTIONS ==========
    function getTotalBets(
        uint256 marketID
    ) external view returns (uint256, uint256) {
        return (markets[marketID].poolYES, markets[marketID].poolNO);
    }

    function getMarketsCount() external view returns (uint256) {
        return markets.length;
    }

    function getProposalsCount() external view returns (uint256) {
        return proposals.length;
    }

    function isMarketFinalized(uint256 marketID) external view returns (bool) {
        Market storage m = markets[marketID];
        return m.resolved && m.resolverPaid && m.bondReturned;
    }

    function canWithdraw(
        uint256 marketID,
        address user
    ) external view returns (bool) {
        if (marketID >= markets.length) return false;
        Market storage m = markets[marketID];

        if (!m.resolved) return false;

        uint256 userBet = betsYES[marketID][user] + betsNO[marketID][user];
        return userBet > 0;
    }

    function getResolverStatus(
        uint256 marketID
    )
        external
        view
        returns (
            address resolver,
            uint256 bond,
            bool paid,
            uint256 pendingReward
        )
    {
        Market storage m = markets[marketID];
        resolver = m.resolver;
        bond = m.resolverBond;
        paid = m.resolverPaid;

        if (!paid && m.resolved) {
            uint256 totalPool = m.poolYES + m.poolNO;
            pendingReward = (totalPool * resolverRewardBps) / BPS_DENOM; // ✅ Use configurable
        }
    }

    function getProposalCount() external view returns (uint256) {
        return proposals.length;
    }

    // ✅ NEW ADMIN VIEW FUNCTIONS
    function getAllParameters()
        external
        view
        returns (
            uint256 _stakingRequirement,
            uint256 _resolverBond,
            uint256 _votingDuration,
            uint256 _resolveWindowDuration,
            uint256 _disputeWindow,
            uint256 _resolverRewardBps,
            uint256 _resolverSlashBps
        )
    {
        return (
            stakingRequirement,
            resolverBond,
            votingDuration,
            resolveWindowDuration,
            disputeWindow,
            resolverRewardBps,
            resolverSlashBps
        );
    }
}
