// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./GovernanceToken.sol";

contract PredictionMarketDAO is ReentrancyGuard {
    // struct
    struct Market {
        string question; // câu hỏi đặt cược của Market
        address creator; // người tạo market
        uint256 creatorBond; // số tiền đặt cọc của người tạo market
        uint256 endTime; // thời điểm kết thúc đặt cược
        uint256 proposalDeadline; // thời điểm cuối cùng cho phéo tạo proposal
        uint256 poolYES; // tổng tiền cược cho YES
        uint256 poolNO; // tổng tiền cược cho NO
        bool resolved; // câu hỏi đã được giải quyết thông qua proposal chưa
        bool outcome; // kết quả chung cuộc (true = YES, false = NO)
        address resolver; // địa chỉ người resolve market
        uint256 resolverBond; // số tiền đặt cọc của resolver
        uint256 resolveTime; // thời điểm market được resolve
        uint256 disputeDeadline; // thời gian tranh chấp sau khi proposal được thực thi
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

    // Constants
    uint256 public constant MIN_CREATOR_BOND = 100 ether; // số token tối thiểu stake để tạo market
    uint256 public constant MIN_RESOLVER_BOND = 50 ether; // số token tối thiểu stake để resolve market
    uint256 public constant PROPOSAL_WINDOW_DURATION = 12 hours; // thời gian cho phép tạo proposal sau khi đóng bet
    uint256 public constant PROPOSAL_VOTING_DURATION = 1 days; // thời gian vote cho proposal
    uint256 public constant DISPUTE_WINDOW = 2 days; // thời gian tranh chấp sau khi proposal được thực thi
    uint256 public constant RESOLVER_REWARD_BPS = 100; // 1% - thưởng nếu resolver đúng
    uint256 public constant RESOLVER_SLASH_BPS = 5000; // 50% - phạt nếu resolver sai
    uint256 public constant BPS_DENOM = 10000;

    uint256 public defaultProposalId = type(uint256).max; // giá trị đặc biệt cho biết market không có proposal liên quan

    //Mappings
    mapping(uint256 => mapping(address => uint256)) public betsYES; // Số ETH đặt cược YES của mỗi địa chỉ cho mỗi market
    mapping(uint256 => mapping(address => uint256)) public betsNO; // Số ETH đặt cược NO của mỗi địa chỉ cho mỗi market
    mapping(uint256 => mapping(address => uint256)) public usedVotingPower; // Tổng trọng số đã vote của mỗi người dùng (cho phép user vote nhiều lần, với các trọng số tùy chỉnh)
    mapping(address => bool) public executors;

    // Configurable parameters
    uint256 public feeBps = 200; // default fee 2% (chia cho 100)
    uint256 public soloBonusRate = 500; // nếu tất cả thắng, trích 5% từ tổng quỹ
    uint256 public returnFeeBps = 8000; // nếu thua thì trả lại 80% số tiền
    uint256 public vaultBalance; // Tổng số dư của vault
    address public owner; // Địa chỉ người quản lý

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

    // ========== CONSTRUCTOR ==========

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        govToken = new GovernanceToken(initialSupply);
        executors[owner] = true;
    }

    // cho phép contract nhận ETH trực tiếp mà không cần đi kèm call data (đảm bảo an toàn cho tests/funding)
    receive() external payable {
        vaultBalance += msg.value;
        emit Received(msg.sender, msg.value);
    }

    // ========== MARKET FUNCTIONS ==========

    // tạo Market với yêu cầu câu hỏi đặt cược và khoảng thời gian cho phép đặt cược
    /**
     * @dev Create a new prediction market
     * @param question The question to predict
     * @param durationTime Duration for betting (in seconds)
     *
     * Requirements:
     * - Creator must have MIN_CREATOR_BOND (100 GOV)
     * - Creator must approve() this contract first
     *
     * Effects:
     * - Pulls 100 GOV from creator (locked until finalize)
     * - Sets endTime = now + durationTime
     * - Sets proposalDeadline = endTime + 12 hours
     */
    function createMarket(
        string calldata question,
        uint256 durationTime
    ) external {
        require(durationTime > 0, "Duration must be > 0");

        // Pull GOV bond from creator
        require(
            govToken.balanceOf(msg.sender) >= MIN_CREATOR_BOND,
            "Insufficient GOV for creator bond"
        );
        require(
            govToken.transferFrom(msg.sender, address(this), MIN_CREATOR_BOND),
            "Creator bond transfer failed"
        );

        uint256 _endTime = block.timestamp + durationTime;
        uint256 _proposalDeadline = _endTime + PROPOSAL_WINDOW_DURATION;

        markets.push(
            Market({
                question: question,
                creator: msg.sender,
                creatorBond: MIN_CREATOR_BOND,
                endTime: _endTime,
                proposalDeadline: _proposalDeadline,
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
            MIN_CREATOR_BOND
        );
    }

    // người dùng đặt cược vào một market
    /**
     * @dev Place a bet on a market
     * @param marketID Market to bet on
     * @param onYES true = bet YES, false = bet NO
     * 
     * Requirements:
     * - Before endTime
     * - Market not resolved
     * - Send ETH with transaction
     */
    function placeBet(uint256 marketID, bool onYES) external payable {
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

    

    // ========== Proposal / DAO ==========

    /**
     * @dev Resolve a market (anyone can call, must stake GOV bond)
     * @param marketID Market to resolve
     * @param outcome Proposed outcome (true = YES, false = NO)
     * 
     * Requirements:
     * - Sau endTime
     * - Market chưa được resolved
     * - Người gọi phải có tối thiểu MIN_RESOLVER_BOND (50 GOV) để Stake
     * - Người gọi phải approve() cho contract này trước
     * 
     * Effects:
     * - Người gọi stake 50 GOV (khóa trong 2 ngày tranh chấp)
     * - Đặt disputeDeadline = now + 2 ngày
     * - Tự động đóng cược nếu chưa đóng
     */
    function resolveMarket(uint256 marketID, bool outcome)
        external
        autoCloseBetting(marketID)
    {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(m.bettingClosed, "Betting not closed");
        require(!m.resolved, "Already resolved");

        // Pull GOV bond from resolver
        require(
            govToken.balanceOf(msg.sender) >= MIN_RESOLVER_BOND,
            "Insufficient GOV for resolver bond"
        );
        require(
            govToken.transferFrom(msg.sender, address(this), MIN_RESOLVER_BOND),
            "Resolver bond transfer failed"
        );

        m.resolved = true;
        m.outcome = outcome;
        m.resolver = msg.sender;
        m.resolverBond = MIN_RESOLVER_BOND;
        m.resolveTime = block.timestamp;
        m.disputeDeadline = block.timestamp + DISPUTE_WINDOW;

        emit MarketResolved(marketID, outcome, msg.sender, MIN_RESOLVER_BOND);
    }

    /**
     * @dev Finalize resolve if no dispute (anyone can call) 
     * @param marketID Market to finalize
     * 
     * Requirements:
     * - Sau khi disputeDeadline
     * - Không có proposal đang hoạt động
     * - Resolver chưa được trả
     * 
     * Effects:
     * - Trả lại 50 GOV bond cho resolver
     * - Trả 1% tổng pool làm phần thưởng ETH cho resolver
     * - Trả lại 100 GOV bond cho creator
     */
    function finalizeResolve(uint256 marketID) external nonReentrant {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(m.resolved, "Not resolved yet");
        require(block.timestamp >= m.disputeDeadline, "Dispute window open");
        require(
            m.relatedProposalId == defaultProposalId,
            "Has active dispute"
        );
        require(!m.resolverPaid, "Resolver already paid");

        _rewardResolver(marketID);
        _returnCreatorBond(marketID);
    }

    // ========== PROPOSAL / DISPUTE FUNCTIONS ==========
    
    /**
     * @dev Create a dispute proposal (only if disagree with resolver)
     * @param description Reason for dispute
     * @param marketID Market being disputed
     * @param correctOutcome What the correct outcome should be
     * 
     * Requirements:
     * - Market đã được resolved
     * - Trong khoảng thời gian tranh chấp
     * - correctOutcome != m.outcome (phải khác nhau)
     * - Người gọi có GOV token (để vote)
     * - Market chưa có proposal
     * 
     * Effects:
     * - Creates proposal with snapshot = m.snapshotBlock (endTime)
     * - Sets voting deadline = now + 1 day
     */
    function createDisputeProposal(
        string calldata description,
        uint256 marketID,
        bool correctOutcome
    ) external autoCloseBetting(marketID) {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];

        require(m.resolved, "Market not resolved yet");
        require(
            block.timestamp <= m.disputeDeadline,
            "Dispute window closed"
        );
        require(
            m.relatedProposalId == defaultProposalId,
            "Market already has dispute"
        );
        require(
            correctOutcome != m.outcome,
            "Proposal must disagree with resolver"
        );

        uint256 deadline = block.timestamp + PROPOSAL_VOTING_DURATION;
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

    /**
     * @dev Vote on a dispute proposal
     * @param proposalID Proposal to vote on
     * @param support true = vote FOR, false = vote AGAINST
     * @param amount Voting power to use (can vote multiple times)
     * 
     * Requirements:
     * - Before voting deadline
     * - Voter has voting power at proposal.snapshotBlock
     * - amount <= remaining voting power
     * 
     * Note: Voting power based on GOV balance at market endTime
     */
    function vote(uint256 proposalID, bool support, uint256 amount) external {
        require(proposalID < proposals.length, "Invalid proposal");
        Proposal storage p = proposals[proposalID];
        require(block.timestamp < p.deadline, "Voting closed");

        uint256 totalPower = govToken.getPastVotes(
            msg.sender,
            p.snapshotBlock
        );
        uint256 used = usedVotingPower[proposalID][msg.sender];
        require(totalPower > used, "No remaining voting power");
        require(amount > 0 && amount <= totalPower - used, "Invalid amount");

        usedVotingPower[proposalID][msg.sender] += amount;

        if (support) {
            p.votesFor += amount;
        } else {
            p.votesAgainst += amount;
        }

        emit Voted(proposalID, msg.sender, support, amount);
    }

    /**
     * @dev Execute a dispute proposal (only owner/executor)
     * @param proposalID Proposal to execute
     * 
     * Requirements:
     * - Caller is executor (owner or whitelisted)
     * - After voting deadline
     * - Not executed yet
     * 
     * Effects if dispute passed (votesFor > votesAgainst):
     * - Changes market outcome to proposal.executeYES
     * - Slashes resolver 50% of bond (25 GOV to vault)
     * - Returns remaining 50% to resolver
     * - Returns creator bond
     * 
     * Effects if dispute failed:
     * - Keeps original outcome
     * - Rewards resolver (bond + 1% pool)
     * - Returns creator bond
     */
    function executeProposal(uint256 proposalID) external nonReentrant {
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

            uint256 slashed = (m.resolverBond * RESOLVER_SLASH_BPS) /
                BPS_DENOM;
            uint256 returnToResolver = m.resolverBond - slashed;

            vaultBalance += slashed;

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
        emit ProposalExecuted(proposalID, disputePassed, msg.sender);
    }

     // ========== INTERNAL FUNCTIONS ==========
    
    /**
     * @dev Internal: Reward resolver for correct resolution
     */
    function _rewardResolver(uint256 marketID) internal {
        Market storage m = markets[marketID];
        if (m.resolverPaid) return;

        uint256 totalPool = m.poolYES + m.poolNO;
        uint256 reward = (totalPool * RESOLVER_REWARD_BPS) / BPS_DENOM;

        // Return bond
        if (m.resolverBond > 0) {
            require(
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

    /**
     * @dev Internal: Return creator bond
     */
    function _returnCreatorBond(uint256 marketID) internal {
        Market storage m = markets[marketID];
        if (m.bondReturned || m.creatorBond == 0) return;

        m.bondReturned = true;
        require(
            govToken.transfer(m.creator, m.creatorBond),
            "Creator bond return failed"
        );

        emit CreatorBondReturned(marketID, m.creator, m.creatorBond);
    }

    // ========== WITHDRAWAL FUNCTION ==========
    
    /**
     * @dev Withdraw winnings from a resolved market
     * @param marketID Market to withdraw from
     * 
     * Auto-finalize:
     * - If resolver not paid yet and no active dispute → pays resolver
     * - If creator bond not returned → returns creator bond
     * 
     * Payout calculation:
     * - Winner: stake + share of loser pool - 2% fee
     * - Loser: 80% refund
     * - Solo winner (no loser pool): stake - 2% fee + 5% vault bonus
     */
    function withdrawWinnings(uint256 marketID) external nonReentrant {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(m.resolved, "Market not resolved");

        // ========== AUTO FINALIZE ==========
        if (!m.resolverPaid && m.resolver != address(0)) {
            bool hasActiveDispute = (m.relatedProposalId !=
                defaultProposalId &&
                !proposals[m.relatedProposalId].executed);

            if (!hasActiveDispute) {
                _rewardResolver(marketID);
            }
        }

        if (!m.bondReturned) {
            _returnCreatorBond(marketID);
        }

        // ========== WITHDRAW LOGIC ==========
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
                uint256 soloBonus = (vaultBalance * soloBonusRate) / BPS_DENOM;
                uint256 userBonus = (userWinner * soloBonus) / winnerPool;
                payout += userWinner - defaultFee + userBonus;
                fee += defaultFee;
                vaultBalance -= soloBonus;
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

    // ========== ADMIN FUNCTIONS ==========
    
    function setExecutor(address executor, bool status) external {
        require(msg.sender == owner, "Only owner");
        executors[executor] = status;
        emit ExecutorUpdated(executor, status);
    }

    function setFeeBps(uint256 newFeeBps) external {
        require(msg.sender == owner, "Only owner");
        require(newFeeBps <= BPS_DENOM, "Invalid fee");
        feeBps = newFeeBps;
    }

    function setSoloBonusRate(uint256 newSoloBonusRate) external {
        require(msg.sender == owner, "Only owner");
        require(newSoloBonusRate <= BPS_DENOM, "Invalid fee");
        soloBonusRate = newSoloBonusRate;
    }

    function setReturnFeeBps(uint256 newReturnFeeBps) external {
        require(msg.sender == owner, "Only owner");
        require(newReturnFeeBps <= BPS_DENOM, "Invalid fee");
        returnFeeBps = newReturnFeeBps;
    }

    function withdrawVault(address payable to, uint256 amount)
        external
        nonReentrant
    {
        require(msg.sender == owner, "Only owner");
        require(amount <= vaultBalance, "Insufficient vault");
        vaultBalance -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Vault transfer failed");
        emit VaultWithdrawn(to, amount);
    }

    // ========== VIEW FUNCTIONS ==========
    
    function getTotalBets(uint256 marketID)
        external
        view
        returns (uint256, uint256)
    {
        return (markets[marketID].poolYES, markets[marketID].poolNO);
    }

    function getMarketsCount() external view returns (uint256) {
        return markets.length;
    }

    function getProposalsCount() external view returns (uint256) {
        return proposals.length;
    }

    function isMarketFinalized(uint256 marketID)
        external
        view
        returns (bool)
    {
        Market storage m = markets[marketID];
        return m.resolved && m.resolverPaid && m.bondReturned;
    }

    function canWithdraw(uint256 marketID, address user)
        external
        view
        returns (bool)
    {
        if (marketID >= markets.length) return false;
        Market storage m = markets[marketID];

        if (!m.resolved) return false;

        uint256 userBet = betsYES[marketID][user] + betsNO[marketID][user];
        return userBet > 0;
    }

    function getResolverStatus(uint256 marketID)
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
            pendingReward = (totalPool * RESOLVER_REWARD_BPS) / BPS_DENOM;
        }
    }
}
