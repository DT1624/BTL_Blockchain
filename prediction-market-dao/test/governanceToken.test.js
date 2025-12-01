const { expect } = require("chai");
const hre = require("hardhat");
const ethers = hre.ethers;

describe("GovernanceToken (buy/sell + fee + limits)", () => {
    let owner, alice, bob;
    let token;

    // cấu hình mặc định cho test
    const initialSupply = ethers.parseEther("1000000"); // 1,000,000 GOV (18 decimals)
    const rate = 1000n; // 1 ETH = 1000 GOV
    const buyFeeBps = 500; // 5%
    const sellFeeBps = 250; // 2.5%
    const maxBuyPerTx = ethers.parseEther("1500"); // giới hạn net mỗi lần mua
    const maxSellPerTx = ethers.parseEther("5000");
    const maxBuyPerAddress = ethers.parseEther("7000");

    beforeEach(async () => {
        [owner, alice, bob] = await ethers.getSigners();

        const GovernanceToken = await ethers.getContractFactory("GovernanceToken", owner);
        token = await GovernanceToken.deploy(initialSupply);
        await token.waitForDeployment();

        // chuyển thanh khoản token vào contract để bán ra
        const liquidityTokens = ethers.parseEther("500000"); // 500k GOV nạp vào contract
        await token.connect(owner).transfer(await token.getAddress(), liquidityTokens);

        // nạp ETH vào contract để có thể trả cho người bán
        await owner.sendTransaction({ to: await token.getAddress(), value: ethers.parseEther("100") });

        // cấu hình rate, fee, limits
        await token.connect(owner).setRate(rate);
        await token.connect(owner).setFees(buyFeeBps, sellFeeBps);
        await token.connect(owner).setLimits(maxBuyPerTx, maxSellPerTx, maxBuyPerAddress);
        await token.connect(owner).setFeeRecipient(await (await owner).getAddress());
    });

    it("khởi tạo đúng: owner nhận initialSupply", async () => {
        const ownerAddr = await owner.getAddress();
        const total = await token.totalSupply();
        const ownerBal = await token.balanceOf(ownerAddr);
        expect(total).to.equal(initialSupply);
        expect(ownerBal).to.equal(initialSupply - ethers.parseEther("500000")); // đã chuyển 500k vào contract
    });

    it("mua token: tính fee token, tôn trọng giới hạn per tx và per address, phát event", async () => {
        const buyer = alice;
        const buyerAddr = await buyer.getAddress();

        const ethIn = ethers.parseEther("1"); // gửi 1 ETH
        // tokensGross = 1 * 1000 = 1000 GOV
        const tokensGross = ethers.parseEther("1000");
        const feeTokens = (tokensGross * BigInt(buyFeeBps)) / 10000n; // 5% = 50 GOV
        const tokensNet = tokensGross - feeTokens;

        // phù hợp maxBuyPerTx=1500 và maxBuyPerAddress=3000
        await expect(token.connect(buyer).buyTokens({ value: ethIn }))
            .to.emit(token, "TokensPurchased")
            .withArgs(buyerAddr, ethIn, tokensGross, tokensNet, feeTokens);

        const buyerBal = await token.balanceOf(buyerAddr);
        expect(buyerBal).to.equal(tokensNet);

        const feeRecipient = await owner.getAddress();
        const feeBal = await token.balanceOf(feeRecipient);
        // owner có sẵn initialSupply - liquidityTokens, cộng thêm fee nhận được
        const expectedOwnerBase = initialSupply - ethers.parseEther("500000");
        expect(feeBal).to.equal(expectedOwnerBase + feeTokens);

        const totalBought = await token.totalBought(buyerAddr);
        expect(totalBought).to.equal(tokensNet);
    });

    it("mua vượt maxBuyPerTx: bị revert", async () => {
        const buyer = alice;
        // cần ETH > 1.5 net, chọn 2 ETH => gross 2000, fee 100, net 1900 > 1500 -> fail
        await expect(token.connect(buyer).buyTokens({ value: ethers.parseEther("2") }))
            .to.be.revertedWith("Exceeds maxBuyPerTx");
    });

    it("mua tích lũy vượt maxBuyPerAddress: bị revert ở lần 6", async () => {
        const buyer = alice;
        // lần 1: 1 ETH -> net 950
        await token.connect(buyer).buyTokens({ value: ethers.parseEther("1") });

        // lần 2: 2 ETH -> net 1900; tổng 2850 <= 3000 -> ok
        await token.connect(buyer).buyTokens({ value: ethers.parseEther("1.5") });
        await token.connect(buyer).buyTokens({ value: ethers.parseEther("1.5") });
        await token.connect(buyer).buyTokens({ value: ethers.parseEther("1.5") });
        await token.connect(buyer).buyTokens({ value: ethers.parseEther("1") });

        // lần 3: 1 ETH -> thêm 950; tổng = 3800 > 3000 -> fail
        await expect(token.connect(buyer).buyTokens({ value: ethers.parseEther("1") }))
            .to.be.revertedWith("Exceeds maxBuyPerAddress");
    });

    it("mua thất bại nếu contract thiếu token thanh khoản", async () => {
        // rút gần hết token khỏi contract
        const contractAddr = await token.getAddress();
        const contractBal = await token.balanceOf(contractAddr);
        await token.connect(owner).withdrawTokens(contractBal, await owner.getAddress());

        await expect(token.connect(alice).buyTokens({ value: ethers.parseEther("0.1") }))
            .to.be.revertedWith("Insufficient token liquidity");
    });

    it("bán token: tính fee ETH, kiểm tra ETH liquidity, phát event", async () => {
        const seller = bob;
        const sellerAddr = await seller.getAddress();

        // bob mua trước để có token
        await token.connect(seller).buyTokens({ value: ethers.parseEther("1") });
        const bobTokens = await token.balanceOf(sellerAddr);

        // bán toàn bộ
        const tokenAmount = bobTokens;
        const ethGross = tokenAmount / rate; // làm tròn xuống
        const feeEth = (ethGross * BigInt(sellFeeBps)) / 10000n;
        const ethNet = ethGross - feeEth;

        const prevEth = await ethers.provider.getBalance(sellerAddr);

        const tx = await token.connect(seller).sellTokens(tokenAmount);
        const receipt = await tx.wait();
        const gasPaid = receipt.gasUsed * receipt.gasPrice;

        await expect(tx)
            .to.emit(token, "TokensSold")
            .withArgs(sellerAddr, tokenAmount, ethGross, ethNet, feeEth);

        const postEth = await ethers.provider.getBalance(sellerAddr);
        // post = prev - gas + ethNet
        expect(postEth).to.be.closeTo(prevEth - gasPaid + ethNet, ethers.parseEther("0.0000001"));

        // seller đã chuyển token vào contract
        const sellerTokenAfter = await token.balanceOf(sellerAddr);
        expect(sellerTokenAfter).to.equal(0);
    });

    it("bán vượt maxSellPerTx: revert", async () => {
        const seller = alice;
        // mua đủ để thử giới hạn
        for (let i = 0; i < 7; i++) {
            await token.connect(seller).buyTokens({ value: ethers.parseEther("1") }); // total net = 9500 GOV
        }

        const tooMuch = ethers.parseEther("6000"); // > maxSellPerTx=5000
        await expect(token.connect(seller).sellTokens(tooMuch)).to.be.revertedWith("Exceeds maxSellPerTx");
    });

    it("bán thất bại nếu contract thiếu ETH thanh khoản", async () => {
        const seller = alice;
        // mua để có token
        await token.connect(seller).buyTokens({ value: ethers.parseEther("1") });
        const amount = await token.balanceOf(await seller.getAddress());

        // rút hết ETH của contract
        const contractEth = await ethers.provider.getBalance(await token.getAddress());
        await token.connect(owner).withdrawEther(contractEth, await owner.getAddress());

        await expect(token.connect(seller).sellTokens(amount)).to.be.revertedWith("Insufficient ETH liquidity");
    });

    it("owner có thể cập nhật rate, fees, limits và feeRecipient", async () => {
        await expect(token.connect(owner).setRate(2000))
            .to.emit(token, "RateUpdated")
            .withArgs(rate, 2000);

        await expect(token.connect(owner).setFees(100, 200))
            .to.emit(token, "FeesUpdated")
            .withArgs(buyFeeBps, sellFeeBps, 100, 200);

        await expect(token.connect(owner).setLimits(1n, 2n, 3n))
            .to.emit(token, "LimitsUpdated")
            .withArgs(1n, 2n, 3n);

        const newRecipient = await bob.getAddress();
        await expect(token.connect(owner).setFeeRecipient(newRecipient))
            .to.emit(token, "FeeRecipientUpdated")
            .withArgs(await owner.getAddress(), newRecipient);
    });

    it("chỉ owner mới được gọi các hàm quản trị", async () => {
        await expect(token.connect(alice).setRate(1)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
            .withArgs(alice.address);
        await expect(token.connect(alice).setFees(1, 1)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
            .withArgs(alice.address);
        await expect(token.connect(alice).setLimits(0, 0, 0)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
            .withArgs(alice.address);
        await expect(token.connect(alice).setFeeRecipient(await alice.getAddress()))
            .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
            .withArgs(alice.address);
        await expect(token.connect(alice).withdrawEther(1n, await alice.getAddress()))
            .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
            .withArgs(alice.address);
        await expect(token.connect(alice).withdrawTokens(1n, await alice.getAddress()))
            .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
            .withArgs(alice.address);
    });

    it("withdrawEther/withdrawTokens hoạt động và phát event", async () => {
        const to = await owner.getAddress();
        // rút một phần ETH
        await expect(token.connect(owner).withdrawEther(ethers.parseEther("1"), to))
            .to.emit(token, "EtherWithdrawn")
            .withArgs(to, ethers.parseEther("1"));

        // rút một phần token
        await expect(token.connect(owner).withdrawTokens(ethers.parseEther("1000"), to))
            .to.emit(token, "TokensWithdrawn")
            .withArgs(to, ethers.parseEther("1000"));
    });

    it("buyTokens: Net=0 khi phí = 100% (buyFeeBps=10000) sẽ revert", async () => {
        // đặt buyFee = 100% để feeTokens == tokensGross
        await token.connect(owner).setFees(10_000, sellFeeBps);
        // gửi 1 wei, tokensGross > 0 nhưng net = 0 -> revert "Net=0"
        await expect(token.connect(alice).buyTokens({ value: 1n })).to.be.revertedWith("Net=0");
    });

    it("sellTokens: Too small khi tokenAmount quá nhỏ (ethGross=0) sẽ revert", async () => {
        // phải cho alice có token để bán
        await token.connect(owner).transfer(alice.address, ethers.parseEther("1"));
        await token.connect(owner).setRate(10_000_000_000_000n); // cực lớn để ethGross = 0
        await expect(token.connect(alice).sellTokens(1n)).to.be.revertedWith("Too small");
    });

    it("buyTokens: Insufficient token liquidity khi contract không đủ cả net+fee", async () => {
        // tắt giới hạn để không bị Exceeds maxBuyPerTx
        await token.connect(owner).setLimits(0, 0, 0);// đặt rate cao để gross lớn
        await token.connect(owner).setRate(10_000_000_000n); // 10M GOV/ETH
        // rút gần hết token contract
        const contractAddr = await token.getAddress();
        const contractBal = await token.balanceOf(contractAddr);
        await token.connect(owner).withdrawTokens(contractBal - 1n, await owner.getAddress());

        await expect(token.connect(alice).buyTokens({ value: ethers.parseEther("1") }))
            .to.be.revertedWith("Insufficient token liquidity");
    });
});