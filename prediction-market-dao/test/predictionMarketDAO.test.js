const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const hre = require("hardhat");
const ethers = hre.ethers;

describe("Prediction Market DAO Tests", function () {
    let developer, user1, user2, user3;
    let DAO, dao, daoAddress;
    let gov, govAddress;

    const toETH = (v) => ethers.parseEther(v.toString());

    async function increaseTime(seconds) {
        await ethers.provider.send("evm_increaseTime", [seconds]);      // tăng thời giam EVM
        await ethers.provider.send("evm_mine", []);                     // Tạo block mới để ghi timestamp
    }

    beforeEach(async function () {
        [developer, user1, user2, user3] = await ethers.getSigners();
        DAO = await ethers.getContractFactory(
            "contracts/PredictionMarketDAO.sol:PredictionMarketDAO"
        );
        const initialSupply = 10 ** 4;
        dao = await DAO.deploy(toETH(initialSupply));
        daoAddress = await dao.getAddress();

        govAddress = await dao.govToken();
        gov = await ethers.getContractAt("contracts/GovernanceToken.sol:GovernanceToken", govAddress);

        await hre.network.provider.send("hardhat_setBalance", [
            daoAddress,
            "0x56BC75E2D63100000", // 100 ETH in hex
        ]);
    });

    it("should revert if user has no governance token", async function () {
        await expect(
            dao.connect(user1).createMarket("Will BTC > $100k by 2026?", 1000)
        ).to.be.revertedWith("You must hold governance tokens to create a market");
    });

    it("should revert if duration is 0", async function () {
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));

        await expect(
            dao.connect(user1).createMarket("Will BTC > $100k by 2026?", 0)
        ).to.be.revertedWith("Duration must be > 0");
    });

    it("Create a market success", async function () {
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));

        const question = "Will BTC > $100k by 2026?";
        const duration = 100;
        await expect(
            dao.connect(user1).createMarket(question, duration)
        ).to.emit(dao, "MarketCreated")
            .withArgs(0, question, anyValue, user1.address);
        const count = await dao.getMarketsCount();
        expect(count).to.equal(1);
    });

    it("should revert if marketID is invalid", async function () {
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));

        await dao.connect(user1).createMarket("Will BTC > $100k by 2026?", 3600);
        const count = await dao.getMarketsCount();
        expect(count).to.equal(1);

        await expect(
            dao.connect(user1).placeBet(1, true, { value: toETH(1) })
        ).to.be.revertedWith("Invalid market");
    });

    it("should revert if market closed", async function () {
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));

        await dao.connect(user1).createMarket("Will BTC > $100k by 2026?", 3600);
        const count = await dao.getMarketsCount();
        expect(count).to.equal(1);

        increaseTime(4000);

        await expect(
            dao.connect(user1).placeBet(0, true, { value: toETH(1) })
        ).to.be.revertedWith("Market closed");
    });

    it("should revert if invalid amount", async function () {
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));

        await dao.connect(user1).createMarket("Will BTC > $100k by 2026?", 3600);
        const count = await dao.getMarketsCount();
        expect(count).to.equal(1);

        increaseTime(2000);
        await expect(
            dao.connect(user1).placeBet(0, true, { value: 0 })
        ).to.be.revertedWith("Invalid amount");
    });

    it("Create a market and allows bets success", async function () {
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));
        await gov.connect(daoSigner).transfer(user2.address, toETH(50));
        expect(await gov.balanceOf(user1.address)).to.equal(toETH(100));
        expect(await gov.balanceOf(user2.address)).to.equal(toETH(50));

        const question = "Will BTC > $100k by 2026?";
        const duration = 100;
        await expect(
            dao.connect(user1).createMarket(question, duration)
        ).to.emit(dao, "MarketCreated")
            .withArgs(0, question, anyValue, user1.address);

        await expect(
            dao.connect(user1).placeBet(0, true, { value: toETH(1) })
        ).to.emit(dao, "PlaceBet")
            .withArgs(0, user1.address, true, toETH(1));

        await expect(
            dao.connect(user2).placeBet(0, false, { value: toETH(2) })
        ).to.emit(dao, "PlaceBet")
            .withArgs(0, user2.address, false, toETH(2));

        await expect(
            dao.connect(user2).createMarket(question, duration)
        ).to.emit(dao, "MarketCreated")
            .withArgs(1, question, anyValue, user2.address);
        const count = await dao.getMarketsCount();
        expect(count).to.equal(2);

        const markets = await dao.markets(0);
        expect(markets.poolYES).to.equal(toETH(1));
        expect(markets.poolNO).to.equal(toETH(2));
    });

    it("DAO proposal lifecycle: delegate, partial votes, execute -> resolves market", async function () {
        // prepare GOV tokens to user1 and user2
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));
        await gov.connect(daoSigner).transfer(user2.address, toETH(50));
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [daoAddress]);

        // delegate to self to enable voting power
        await gov.connect(user1).delegate(user1.address);
        await gov.connect(user2).delegate(user2.address);

        // user1 creates a market and bets
        await dao.connect(user1).createMarket("Governed market", 3600);
        await dao.connect(user1).placeBet(0, true, { value: toETH(1) });
        await dao.connect(user2).placeBet(0, false, { value: toETH(1) });

        // user1 creates a proposal to resolve YES
        await dao.connect(user1).createProposal("Resolve YES", 0, true);

        // partial votes: user1 uses 60 GOV, user2 uses 25 GOV
        // getPastVotes uses snapshot at proposal creation, so delegation before creation OK
        await dao.connect(user1).vote(0, true, toETH(60));
        await dao.connect(user2).vote(0, false, toETH(25));

        // user1 tries to over-vote (should revert)
        await expect(dao.connect(user1).vote(0, true, toETH(50))).to.be.revertedWith("Invalid amount");

        // fast-forward and execute
        await increaseTime(24 * 3600 + 10);
        await dao.connect(user3).executeProposal(0);

        const m = await dao.markets(0);
        expect(m.resolved).to.equal(true);
        expect(m.outcome).to.equal(true);

        // relatedProposalId cleared
        expect(m.relatedProposalId).to.equal((await dao.defaultProposalId()));
    });

    it("withdrawWinnings normal case: fees and vault accounting", async function () {
        // prepare GOV for proposal flow then resolve via public to focus on payout math
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));
        await gov.connect(daoSigner).transfer(user2.address, toETH(50));
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [daoAddress]);

        // delegate so proposals work if needed
        await gov.connect(user1).delegate(user1.address);
        await gov.connect(user2).delegate(user2.address);

        // create market and bets
        await dao.connect(user1).createMarket("PayoutTest", 100);
        await dao.connect(user1).placeBet(0, true, { value: toETH(1) }); // YES pool = 1
        await dao.connect(user2).placeBet(0, false, { value: toETH(1) }); // NO pool = 1

        // resolve market publicly as YES after endTime
        await increaseTime(200);
        await dao.connect(user3).resolveMarketPublic(0, true);

        // winner (user1) withdraw
        const beforeWinner = await ethers.provider.getBalance(user1.address);
        const tx = await dao.connect(user1).withdrawWinnings(0);
        const r = await tx.wait();
        const gas = r.gasUsed * r.gasPrice;
        const afterWinner = await ethers.provider.getBalance(user1.address);

        // gross payout = 1 + (1 * 1 / 1) = 2 ETH; feeBps = 200 => fee = 0.04 ETH; payout = 1.96 ETH
        const expectedGross = toETH(2);
        const expectedFee = (expectedGross * 200n) / 10000n;
        const expectedPayout = expectedGross - expectedFee;
        expect((afterWinner - beforeWinner + gas).toString()).to.equal(expectedPayout.toString());

        // loser (user2) withdraw gets 80% back
        const beforeLoser = await ethers.provider.getBalance(user2.address);
        const tx2 = await dao.connect(user2).withdrawWinnings(0);
        const r2 = await tx2.wait();
        const gas2 = r2.gasUsed * r2.gasPrice;
        const afterLoser = await ethers.provider.getBalance(user2.address);

        const expectedReturn = (toETH(1) * 8000n) / 10000n; // 0.8 ETH
        expect((afterLoser - beforeLoser + gas2).toString()).to.equal(expectedReturn.toString());

        // vault should have accumulated both fees: winnerFee + loserFee
        const vault = await dao.vaultBalance();
        const loserFee = toETH(1) - expectedReturn; // 0.2 ETH
        const totalExpectedVault = expectedFee + loserFee;
        expect(vault).to.equal(totalExpectedVault);
    });

    it("solo-case uses vault bonus and default fee as described", async function () {
        // Setup to accumulate some vault balance first via a normal market
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        const daoSigner = await ethers.getSigner(daoAddress);
        await gov.connect(daoSigner).transfer(user1.address, toETH(100));
        await gov.connect(daoSigner).transfer(user2.address, toETH(50));
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [daoAddress]);

        await gov.connect(user1).delegate(user1.address);
        await gov.connect(user2).delegate(user2.address);

        // Market A: produce vault fees
        await dao.connect(user1).createMarket("FeeSeed", 100);
        await dao.connect(user1).placeBet(0, true, { value: toETH(1) });
        await dao.connect(user2).placeBet(0, false, { value: toETH(1) });
        await increaseTime(200);
        await dao.connect(user3).resolveMarketPublic(0, true);
        // user1 withdraw (winner)
        await dao.connect(user1).withdrawWinnings(0);
        // user2 withdraw (loser)
        await dao.connect(user2).withdrawWinnings(0);

        const vaultAfterSeed = await dao.vaultBalance();
        expect(vaultAfterSeed).to.be.gt(0n);

        // Market B: solo winners (no loser pool)
        await dao.connect(user1).createMarket("SoloBonus", 100);
        await dao.connect(user1).placeBet(1, true, { value: toETH(3) }); // winnerPool = 3
        await increaseTime(200);
        await dao.connect(user3).resolveMarketPublic(1, true);

        // capture vault before withdraw
        const vaultBefore = await dao.vaultBalance();

        // user1 withdraw: defaultFee = userWinner * feeBps; soloBonus = vaultBefore * soloBonusRate
        const before = await ethers.provider.getBalance(user1.address);
        const tx = await dao.connect(user1).withdrawWinnings(1);
        const rc = await tx.wait();
        const gas = rc.gasUsed * rc.gasPrice;
        const after = await ethers.provider.getBalance(user1.address);

        // calculations:
        // defaultFee = 3 * 2% = 0.06 ETH
        const defaultFee = (toETH(3) * 200n) / 10000n;
        // soloBonus = vaultBefore * soloBonusRate / BPS_DENOM (taken entirely from vault and distributed proportionally; since user is only winner he gets full soloBonus)
        const soloBonus = (vaultBefore * (await dao.soloBonusRate())) / 10000n;
        const expectedPayout = toETH(3) - defaultFee + soloBonus;
        expect((after - before + gas).toString()).to.equal(expectedPayout.toString());

        // vaultAfter = vaultBefore - soloBonus + defaultFee
        const vaultAfter = await dao.vaultBalance();
        expect(vaultAfter).to.equal(vaultBefore - soloBonus + defaultFee);
    });
});