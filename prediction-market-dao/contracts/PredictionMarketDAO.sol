// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./GovernanceToken.sol";

contract PredictionMarketDAO is ReentrancyGuard {
    // struct
    struct Market {
        string question; // câu hỏi đặt cược của Market
        uint256 endTime; // thời điểm kết thúc đặt cược
        uint256 poolYES; // tổng tiền cược cho YES
        uint256 poolNO; // tổng tiền cược cho NO
        bool resolved; // câu hỏi đã được giải quyết thông qua proposal chưa
        bool outcome; // kết quả chung cuộc (true = YES, false = NO)
        uint256 relatedProposalId; // proposalID liên quan tới market này
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

    // variable
    GovernanceToken public govToken;
    Market[] public markets;
    Proposal[] public proposals;
    uint256 public proposalDurationTime = 1 days;
    uint256 public disputePeriod = 1 days;
    uint256 public defaultProposalId = type(uint256).max;

    mapping(uint256 => mapping(address => uint256)) public betsYES; // Số ETH đặt cược YES của mỗi địa chỉ cho mỗi market
    mapping(uint256 => mapping(address => uint256)) public betsNO; // Số ETH đặt cược NO của mỗi địa chỉ cho mỗi market
    mapping(uint256 => mapping(address => uint256)) public usedVotingPower; // Tổng trọng số đã vote của mỗi người dùng (cho phép user vote nhiều lần, với các trọng số tùy chỉnh)

    uint256 public feeBps = 200; // default fee 2% (chia cho 100)
    uint256 public soloBonusRate = 500; // nếu tất cả thắng, trích 5% từ tổng quỹ
    uint256 public returnFeeBps = 8000; // nếu thua thì trả lại 80% số tiền
    uint256 public constant BPS_DENOM = 10000;
    uint256 public vaultBalance; // Tổng số dư của vault
    address public owner; // Địa chỉ người quản lý

    // event
    event MarketCreated(
        uint256 indexed id,
        string question,
        uint256 endTime,
        address creator
    );
    event PlaceBet(
        uint256 indexed marketID,
        address indexed user,
        bool onYES,
        uint256 amount
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
    event ProposalExecuted(uint256 indexed proposalID, bool passed);
    event Withdrawn(
        address indexed user,
        uint256 indexed marketID,
        uint256 amount,
        uint256 fee
    );
    event VaultWithdrawn(address indexed to, uint256 amount);
    event Received(address indexed sender, uint256 amount);

    // constructor
    constructor(uint256 initialSupply) {
        owner = msg.sender;
        govToken = new GovernanceToken(initialSupply);
    }

    // cho phép contract nhận ETH trực tiếp mà không cần đi kèm call data (đảm bảo an toàn cho tests/funding)
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    // ========== Market function ==========

    // tạo Market với yêu cầu câu hỏi đặt cược và khoảng thời gian cho phép đặt cược
    function createMarket(
        string calldata question,
        uint256 durationTime
    ) external {
        require(
            govToken.balanceOf(msg.sender) > 0,
            "You must hold governance tokens to create a market"
        );
        require(durationTime > 0, "Duration must be > 0");
        uint256 _endTime = block.timestamp + durationTime;
        markets.push(
            Market({
                question: question,
                endTime: _endTime,
                poolYES: 0,
                poolNO: 0,
                resolved: false,
                outcome: false,
                relatedProposalId: defaultProposalId
            })
        );
        emit MarketCreated(markets.length - 1, question, _endTime, msg.sender);
    }

    // người dùng đặt cược vào một market
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

    function getTotalBets(
        uint256 marketID
    ) external view returns (uint256, uint256) {
        return (markets[marketID].poolYES, markets[marketID].poolNO);
    }

    function getMarketsCount() external view returns (uint256) {
        return markets.length;
    }

    // ========== Proposal / DAO ==========

    // Chỉ có người sở hữu GOV token mới có thể tạo proposal
    function createProposal(
        string calldata description,
        uint256 marketID,
        bool executeYES
    ) external {
        require(marketID < markets.length, "Invalid market");
        require(
            govToken.balanceOf(msg.sender) > 0,
            "No governance tokens, proposal creation not allowed"
        );
        Market storage m = markets[marketID];
        require(
            m.relatedProposalId == defaultProposalId,
            "Market already has proposal"
        );
        uint256 deadline = block.timestamp + proposalDurationTime;
        m.relatedProposalId = proposals.length;
        // Chỉ dùng được kiểu này nếu trong struct không có mapping
        // Nếu có thì push phần tử trống rồi fill các thuộc tính
        proposals.push(
            Proposal({
                description: description,
                marketID: marketID,
                executeYES: executeYES,
                votesFor: 0,
                votesAgainst: 0,
                deadline: deadline,
                executed: false,
                proposer: msg.sender,
                snapshotBlock: block.number
            })
        );
        emit ProposalCreated(
            proposals.length - 1,
            marketID,
            executeYES,
            msg.sender
        );
    }

    // nguời dùng chỉ có thể vote nếu tại thời điểm proposal được tạo, người đó sở hữu GOV token
    function vote(uint256 proposalID, bool support, uint256 amount) external {
        require(proposalID < proposals.length, "Invalid proposal");
        Proposal storage p = proposals[proposalID];
        require(block.timestamp < p.deadline, "Voting closed");

        uint256 totalPower = govToken.getPastVotes(msg.sender, p.snapshotBlock);
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

    // chỉ những người đã từng đặt cược có thể (không giới hạn chỉ những người có quyền vote)
    function executeProposal(uint256 proposalID) external {
        require(proposalID < proposals.length, "Invalid proposal");
        Proposal storage p = proposals[proposalID];
        require(block.timestamp >= p.deadline, "Voting not finished");
        require(!p.executed, "Already executed");

        bool passed = p.votesFor > p.votesAgainst;
        if (passed) {
            _resolveMarket(p.marketID, p.executeYES);
        }
        p.executed = true;

        // clear market relatedProposalId so resolveMarketPublic knows no active proposal
        Market storage m = markets[p.marketID];
        if (m.relatedProposalId == proposalID) {
            m.relatedProposalId = defaultProposalId;
        }

        emit ProposalExecuted(proposalID, passed);
    }

    // Hàm này chỉ được gọi khi hết time, không có proposal
    // Ai cũng có thể gọi (có thể tùy chỉnh để chỉ oracle cố định gọi, hay cần signature...)
    function resolveMarketPublic(uint256 marketID, bool outcome) external {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(!m.resolved, "Already resolved");

        uint256 canResolveMarketTime = m.endTime;
        if (m.relatedProposalId != defaultProposalId) {
            canResolveMarketTime += disputePeriod;
        }

        require(
            block.timestamp >= canResolveMarketTime,
            "Invalid time to resolve market"
        );
        _resolveMarket(marketID, outcome);
    }

    // logic thực hiện resolve market chỉ được gọi nội bộ trong contract
    function _resolveMarket(uint256 marketID, bool outcome) internal {
        Market storage m = markets[marketID]; // vì lấy từ proposal nên luôn đảm bảo hợp lệ
        require(block.timestamp >= m.endTime, "Market not finished");
        require(!m.resolved, "Already resolved");
        m.resolved = true;
        m.outcome = outcome;
    }

    // chỉ owner của contract có quyền set lại fee thông thường và fee khi chỉ có 1 bên bet thắng
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

    // Owner có thể gọi để rút tiền trong Vault về 1 ví có thể nhận ETH
    function withdrawVault(address payable to, uint256 amount) external nonReentrant {
        require(msg.sender == owner, "Only owner");
        require(amount <= vaultBalance, "Insufficient valut");
        vaultBalance -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Vault transfer failed");
        emit VaultWithdrawn(to, amount);
    }

    // người dùng thắng cược trong các market mới có thể rút thưởng
    function withdrawWinnings(uint256 marketID) external nonReentrant {
        require(marketID < markets.length, "Invalid market");
        Market storage m = markets[marketID];
        require(m.resolved, "Market not resolved");

        // cả 2 trạng thái vì user có thể đặt cược tùy ý
        uint256 userWinner; // số tiền cược vào kết quả thắng
        uint256 userLoser; // số tiền cược vào kết quả thắng
        uint256 winnerPool; // tổng số tiền trong pool thắng
        uint256 loserPool; // tổng số tiền trong pool thua

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

        // ✅ Đảm bảo contract có đủ balance
        require(
            address(this).balance >= winnerPool + loserPool,
            "Insufficient total balance"
        );

        uint256 payout = 0;
        uint256 fee = 0;

        // ========== XỬ LÝ BÊN THUA ==========
        if (userLoser > 0) {
            // Hoàn lại 80% (returnFeeBps), giữ 20% làm fee
            uint256 returnAmount = (userLoser * returnFeeBps) / BPS_DENOM;
            uint256 loserFee = userLoser - returnAmount;
            payout += returnAmount;
            fee += loserFee;
        }

        // ========== XỬ LÝ BÊN THẮNG ==========
        // nếu không thắng thì bỏ qua xét luôn
        if (userWinner > 0) {
            if (loserPool > 0) {
                // TH1: Pool thua có tiền
                // Gross payout = stake + share từ loserPool
                uint256 shareFromLoser = (userWinner * loserPool) / winnerPool;
                uint256 grossPayout = userWinner + shareFromLoser;

                // Tính fee trên gross (luôn tính, không miễn)
                uint256 winnerFee = (grossPayout * feeBps) / BPS_DENOM;

                payout += grossPayout - winnerFee;
                fee += winnerFee;
            } else {
                // TH2: Pool thua không có tiền (solo case)
                // Tính feeBps mặc định trên userWinner
                uint256 defaultFee = (userWinner * feeBps) / BPS_DENOM;

                // Tính tổng bonus từ vault: soloBonusRate từ vaultBalance hiện tại
                uint256 soloBonus = (vaultBalance * soloBonusRate) / BPS_DENOM;
                uint256 userBonus = (userWinner * soloBonus) / winnerPool;

                // Payout = userWinner - defaultFee + userBonus
                payout += userWinner - defaultFee + userBonus;

                // Fee: trừ từ vault để tính soloBonus
                fee += defaultFee;
                // ✅ soloBonus trích từ vault (vault sẽ giảm bằng soloBonus)
                vaultBalance -= soloBonus;
            }
        }

        require(payout > 0, "No payout calculated");
        require(
            address(this).balance >= payout,
            "Insufficient contract balance"
        );

        // Sau khi tính toán thì reset lại cả 2 (vì có thể đặt cả 2)
        betsYES[marketID][msg.sender] = 0;
        betsNO[marketID][msg.sender] = 0;
        vaultBalance += fee;

        (bool sent, ) = payable(msg.sender).call{value: payout}("");
        require(sent, "Transfer failed");

        emit Withdrawn(msg.sender, marketID, payout, fee);
    }
}