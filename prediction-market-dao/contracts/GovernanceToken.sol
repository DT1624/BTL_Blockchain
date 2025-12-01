// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GovernanceToken is
    ERC20,
    ERC20Votes,
    ERC20Permit,
    Ownable,
    ReentrancyGuard
{
    // Rate & fee
    uint256 public rate; // tokens per 1 ETH
    address public feeRecipient;
    uint16 public buyFeeBps; // fee khi mua, thu bằng token (basis points, 10000 = 100%)
    uint16 public sellFeeBps; // fee khi bán, thu bằng ETH
    // Limits
    uint256 public maxBuyPerTx; // tối đa token (net) mỗi giao dịch mua; 0 = không giới hạn
    uint256 public maxSellPerTx; // tối đa token mỗi giao dịch bán; 0 = không giới hạn
    uint256 public maxBuyPerAddress; // tổng token (net) tối đa 1 địa chỉ có thể mua lũy kế; 0 = không giới hạn
    mapping(address => uint256) public totalBought; // lũy kế token đã mua (net)

    // Events
    event TokensPurchased(
        address indexed buyer,
        uint256 ethIn,
        uint256 tokensGross,
        uint256 tokensNet,
        uint256 feeTokens
    );
    event TokensSold(
        address indexed seller,
        uint256 tokensIn,
        uint256 ethGross,
        uint256 ethNet,
        uint256 feeEth
    );
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event FeesUpdated(
        uint16 oldBuyFeeBps,
        uint16 oldSellFeeBps,
        uint16 newBuyFeeBps,
        uint16 newSellFeeBps
    );
    event LimitsUpdated(
        uint256 maxBuyPerTx,
        uint256 maxSellPerTx,
        uint256 maxBuyPerAddress
    );
    event FeeRecipientUpdated(
        address indexed oldRecipient,
        address indexed newRecipient
    );
    event EtherWithdrawn(address indexed to, uint256 amount);
    event TokensWithdrawn(address indexed to, uint256 amount);

    constructor(
        uint256 initialSupply
    )
        ERC20("GovToken", "GOV")
        ERC20Votes()
        ERC20Permit("GovToken")
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupply);
        feeRecipient = msg.sender; // mặc định
        // rate, fees, limits = 0 -> owner cần set trước khi mở giao dịch
    }

    // Mua token bằng ETH
    function buyTokens() external payable nonReentrant {
        require(rate > 0, "Rate=0");
        require(msg.value > 0, "No ETH sent");

        uint256 tokensGross = msg.value * rate; // tổng token theo rate
        require(tokensGross > 0, "Too little ETH");

        uint256 feeTokens = (tokensGross * buyFeeBps) / 10_000; // fee bằng token
        uint256 tokensNet = tokensGross - feeTokens;
        require(tokensNet > 0, "Net=0");

        if (maxBuyPerTx > 0) {
            require(tokensNet <= maxBuyPerTx, "Exceeds maxBuyPerTx");
        }
        if (maxBuyPerAddress > 0) {
            require(
                totalBought[msg.sender] + tokensNet <= maxBuyPerAddress,
                "Exceeds maxBuyPerAddress"
            );
        }

        // Contract phải có đủ token để xuất cả net + fee (tức = tokensGross)
        require(
            balanceOf(address(this)) >= tokensGross,
            "Insufficient token liquidity"
        );

        // Chuyển token
        _transfer(address(this), msg.sender, tokensNet);
        if (feeTokens > 0 && feeRecipient != address(0)) {
            _transfer(address(this), feeRecipient, feeTokens);
        }

        totalBought[msg.sender] += tokensNet;
        emit TokensPurchased(
            msg.sender,
            msg.value,
            tokensGross,
            tokensNet,
            feeTokens
        );
    }

    // Bán token lấy ETH (không cần approve vì contract tự _transfer nội bộ)
    function sellTokens(uint256 tokenAmount) external nonReentrant {
        require(rate > 0, "Rate=0");
        require(tokenAmount > 0, "Zero amount");
        if (maxSellPerTx > 0) {
            require(tokenAmount <= maxSellPerTx, "Exceeds maxSellPerTx");
        }

        // Nhận token vào contract
        _transfer(msg.sender, address(this), tokenAmount);

        // Đổi ra ETH theo rate
        uint256 ethGross = tokenAmount / rate; // làm tròn xuống
        require(ethGross > 0, "Too small");
        uint256 feeEth = (ethGross * sellFeeBps) / 10_000;
        uint256 ethNet = ethGross - feeEth;

        require(
            address(this).balance >= ethGross,
            "Insufficient ETH liquidity"
        );

        // Trả ETH cho người bán
        (bool ok1, ) = msg.sender.call{value: ethNet}("");
        require(ok1, "ETH transfer failed");

        // Gửi fee ETH
        if (feeEth > 0 && feeRecipient != address(0)) {
            (bool ok2, ) = payable(feeRecipient).call{value: feeEth}("");
            require(ok2, "Fee transfer failed");
        }

        emit TokensSold(msg.sender, tokenAmount, ethGross, ethNet, feeEth);
    }

    // Quản trị
    function setRate(uint256 newRate) external onlyOwner {
        emit RateUpdated(rate, newRate);
        rate = newRate;
    }

    function setFees(
        uint16 newBuyFeeBps,
        uint16 newSellFeeBps
    ) external onlyOwner {
        require(
            newBuyFeeBps <= 10_000 && newSellFeeBps <= 10_000, // quá 50% thì là quá cao
            "Fee too high"
        );
        emit FeesUpdated(buyFeeBps, sellFeeBps, newBuyFeeBps, newSellFeeBps);
        buyFeeBps = newBuyFeeBps;
        sellFeeBps = newSellFeeBps;
    }

    function setLimits(
        uint256 _maxBuyPerTx,
        uint256 _maxSellPerTx,
        uint256 _maxBuyPerAddress
    ) external onlyOwner {
        maxBuyPerTx = _maxBuyPerTx;
        maxSellPerTx = _maxSellPerTx;
        maxBuyPerAddress = _maxBuyPerAddress;
        emit LimitsUpdated(_maxBuyPerTx, _maxSellPerTx, _maxBuyPerAddress);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function withdrawEther(
        uint256 amount,
        address payable to
    ) external onlyOwner {
        require(to != address(0), "Zero addr");
        require(address(this).balance >= amount, "Insufficient ETH");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit EtherWithdrawn(to, amount);
    }

    function withdrawTokens(uint256 amount, address to) external onlyOwner {
        require(to != address(0), "Zero addr");
        require(balanceOf(address(this)) >= amount, "Insufficient token");
        _transfer(address(this), to, amount);
        emit TokensWithdrawn(to, amount);
    }

    function enableVoting() external {
        require(delegates(msg.sender) == address(0), "Already delegated");
        _delegate(msg.sender, msg.sender);
    }

    // Overrides required by Solidity
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);

        if (
            to != address(0) &&
            to != address(this) && // ✅ THÊM điều kiện này
            delegates(to) == address(0)
        ) {
            _delegate(to, to);
        }
    }

    function nonces(
        address owner
    ) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    // Nhận ETH để cấp thanh khoản trả bán hoặc do người mua gửi vào
    receive() external payable {}
}