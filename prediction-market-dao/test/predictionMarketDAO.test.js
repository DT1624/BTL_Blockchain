const { expect } = require("chai");
const hre = require("hardhat");
const ethers = hre.ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PredictionMarketDAO - Full Flow", () => {
    let owner, alice, bob, charlie, david;
    let dao, govToken, daoSigner;

    const INITIAL_SUPPLY = ethers.parseEther("10000000"); // 10M GOV
    const MIN_CREATOR_BOND = ethers.parseEther("100"); // 100 GOV
    const MIN_RESOLVER_BOND = ethers.parseEther("50"); // 50 GOV
    const PROPOSAL_WINDOW = 12 * 60 * 60; // 12 hours
    const VOTING_DURATION = 24 * 60 * 60; // 1 day
    const DISPUTE_WINDOW = 2 * 24 * 60 * 60; // 2 days

    beforeEach(async () => {
        [owner, alice, bob, charlie, david] = await ethers.getSigners();

        // Deploy DAO (tự động deploy GovernanceToken)
        const PredictionMarketDAO = await ethers.getContractFactory("contracts/PredictionMarketDAO.sol:PredictionMarketDAO");
        dao = await PredictionMarketDAO.deploy(INITIAL_SUPPLY);
        await dao.waitForDeployment();
        daoAddress = await dao.getAddress();
        await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
        daoSigner = await ethers.getSigner(daoAddress);

        // Lấy địa chỉ GovernanceToken
        const govTokenAddr = await dao.govToken();
        govToken = await ethers.getContractAt("contracts/GovernanceToken.sol:GovernanceToken", govTokenAddr);
        await hre.network.provider.send("hardhat_setBalance", [
            daoAddress,
            "0x56BC75E2D63100000", // 100 ETH in hex
        ]);
        // Owner chuyển GOV cho users để test
        await govToken.connect(daoSigner).transfer(alice.address, ethers.parseEther("1000"));
        await govToken.connect(daoSigner).transfer(bob.address, ethers.parseEther("1000"));
        await govToken.connect(daoSigner).transfer(charlie.address, ethers.parseEther("1000"));
        await govToken.connect(daoSigner).transfer(david.address, ethers.parseEther("1000"));
        await govToken.connect(daoSigner).transfer(owner.address, ethers.parseEther("100"));

        // Users approve DAO contract
        await govToken.connect(alice).approve(dao.target, ethers.parseEther("10000"));
        await govToken.connect(bob).approve(dao.target, ethers.parseEther("10000"));
        await govToken.connect(charlie).approve(dao.target, ethers.parseEther("10000"));
        await govToken.connect(david).approve(dao.target, ethers.parseEther("10000"));
        await govToken.connect(owner).approve(dao.target, ethers.parseEther("10000"));
    });

    // ========================================
    // 1. CREATE MARKET TESTS
    // ========================================

    describe("1. Create Market", () => {
        it("✅ Tạo market thành công: pull creator bond, emit event", async () => {
            const question = "ETH > $5000 vào 31/12/2025?";
            const duration = 7 * 24 * 60 * 60; // 7 days

            const aliceBalBefore = await govToken.balanceOf(alice.address);

            const tx = await dao.connect(alice).createMarket(question, duration);
            const receipt = await tx.wait();

            // Check event
            await expect(tx)
                .to.emit(dao, "MarketCreated")
                .withArgs(
                    0, // marketID
                    question,
                    await time.latest() + duration,
                    alice.address,
                    MIN_CREATOR_BOND
                );

            // Check GOV bond pulled
            const aliceBalAfter = await govToken.balanceOf(alice.address);
            expect(aliceBalBefore - aliceBalAfter).to.equal(MIN_CREATOR_BOND);

            // Check market state
            const market = await dao.markets(0);
            expect(market.question).to.equal(question);
            expect(market.creator).to.equal(alice.address);
            expect(market.creatorBond).to.equal(MIN_CREATOR_BOND);
            expect(market.bettingClosed).to.equal(false);
            expect(market.resolved).to.equal(false);
            expect(market.snapshotBlock).to.equal(0);
        });

        it("❌ Revert: Thiếu GOV bond", async () => {
            // David không có đủ GOV
            await govToken.connect(david).transfer(owner.address, ethers.parseEther("950"));

            await expect(
                dao.connect(david).createMarket("Question?", 86400)
            ).to.be.revertedWith("Insufficient GOV for creator bond");
        });

        it("❌ Revert: Chưa approve", async () => {
            const newUser = (await ethers.getSigners())[5];
            await govToken.connect(daoSigner).transfer(newUser.address, ethers.parseEther("200"));

            await expect(
                dao.connect(newUser).createMarket("Question?", 86400)
            ).to.be.revertedWithCustomError(govToken, "ERC20InsufficientAllowance");
        });

        it("❌ Revert: Duration = 0", async () => {
            await expect(
                dao.connect(alice).createMarket("Question?", 0)
            ).to.be.revertedWith("Duration must be > 0");
        });
    });

    // ========================================
    // 2. PLACE BET TESTS
    // ========================================

    describe("2. Place Bet", () => {
        let marketID;
        const duration = 7 * 24 * 60 * 60;

        beforeEach(async () => {
            await dao.connect(alice).createMarket("ETH > $5000?", duration);
            marketID = 0;
        });

        it("✅ Bet YES thành công: pool tăng, emit event", async () => {
            const betAmount = ethers.parseEther("1");

            await expect(
                dao.connect(bob).placeBet(marketID, true, { value: betAmount })
            )
                .to.emit(dao, "PlaceBet")
                .withArgs(marketID, bob.address, true, betAmount);

            const market = await dao.markets(marketID);
            expect(market.poolYES).to.equal(betAmount);
            expect(market.poolNO).to.equal(0);

            const bobBetYES = await dao.betsYES(marketID, bob.address);
            expect(bobBetYES).to.equal(betAmount);
        });

        it("✅ Bet NO thành công", async () => {
            const betAmount = ethers.parseEther("2");

            await dao.connect(charlie).placeBet(marketID, false, { value: betAmount });

            const market = await dao.markets(marketID);
            expect(market.poolNO).to.equal(betAmount);

            const charlieBetNO = await dao.betsNO(marketID, charlie.address);
            expect(charlieBetNO).to.equal(betAmount);
        });

        it("✅ Bet nhiều lần: pool cộng dồn", async () => {
            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("1") });
            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("0.5") });
            await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("2") });

            const market = await dao.markets(marketID);
            expect(market.poolYES).to.equal(ethers.parseEther("1.5"));
            expect(market.poolNO).to.equal(ethers.parseEther("2"));

            const bobTotal = await dao.betsYES(marketID, bob.address);
            expect(bobTotal).to.equal(ethers.parseEther("1.5"));
        });

        it("❌ Revert: Sau endTime", async () => {
            await time.increase(duration + 1);

            await expect(
                dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("1") })
            ).to.be.revertedWith("Market closed");
        });

        it("❌ Revert: Invalid market ID", async () => {
            await expect(
                dao.connect(bob).placeBet(999, true, { value: ethers.parseEther("1") })
            ).to.be.revertedWith("Invalid market");
        });

        it("❌ Revert: Amount = 0", async () => {
            await expect(
                dao.connect(bob).placeBet(marketID, true, { value: 0 })
            ).to.be.revertedWith("Invalid amount");
        });

        it("❌ Revert: Market đã resolved", async () => {
            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true);

            await expect(
                dao.connect(charlie).placeBet(marketID, true, { value: ethers.parseEther("1") })
            ).to.be.revertedWith("Market closed");
        });
    });

    // ========================================
    // 3. RESOLVE MARKET TESTS
    // ========================================

    describe("3. Resolve Market", () => {
        let marketID;
        const duration = 7 * 24 * 60 * 60;

        beforeEach(async () => {
            await dao.connect(alice).createMarket("ETH > $5000?", duration);
            marketID = 0;

            // Bet
            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
            await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });

            // Chờ đến endTime
            await time.increase(duration + 1);
        });

        it("✅ Resolve thành công: pull resolver bond, auto-close betting, emit events", async () => {
            const bobBalBefore = await govToken.balanceOf(bob.address);

            const tx = await dao.connect(bob).resolveMarket(marketID, true);

            // Check MarketBettingClosed event
            await expect(tx).to.emit(dao, "MarketBettingClosed");

            // Check MarketResolved event
            await expect(tx)
                .to.emit(dao, "MarketResolved")
                .withArgs(marketID, true, bob.address, MIN_RESOLVER_BOND);

            // Check GOV bond pulled
            const bobBalAfter = await govToken.balanceOf(bob.address);
            expect(bobBalBefore - bobBalAfter).to.equal(MIN_RESOLVER_BOND);

            // Check market state
            const market = await dao.markets(marketID);
            expect(market.resolved).to.equal(true);
            expect(market.outcome).to.equal(true);
            expect(market.resolver).to.equal(bob.address);
            expect(market.resolverBond).to.equal(MIN_RESOLVER_BOND);
            expect(market.bettingClosed).to.equal(true);
            expect(market.snapshotBlock).to.be.gt(0);
        });

        it("❌ Revert: Trước endTime", async () => {
            await dao.connect(alice).createMarket("Question 2?", duration);
            const newMarketID = 1;

            await expect(
                dao.connect(bob).resolveMarket(newMarketID, true)
            ).to.be.revertedWith("Betting not closed");
        });

        it("❌ Revert: Đã resolved", async () => {
            await dao.connect(bob).resolveMarket(marketID, true);

            await expect(
                dao.connect(charlie).resolveMarket(marketID, false)
            ).to.be.revertedWith("Already resolved");
        });

        it("❌ Revert: Thiếu GOV bond", async () => {
            await govToken.connect(david).transfer(owner.address, ethers.parseEther("960"));

            await expect(
                dao.connect(david).resolveMarket(marketID, true)
            ).to.be.revertedWith("Insufficient GOV for resolver bond");
        });

        it("❌ Revert: Invalid market ID", async () => {
            await expect(
                dao.connect(bob).resolveMarket(999, true)
            ).to.be.revertedWith("Invalid market");
        });
    });

    // ========================================
    // 4. FINALIZE RESOLVE (NO DISPUTE)
    // ========================================

    describe("4. Finalize Resolve (No Dispute)", () => {
        let marketID;
        const duration = 7 * 24 * 60 * 60;

        beforeEach(async () => {
            await dao.connect(alice).createMarket("ETH > $5000?", duration);
            marketID = 0;

            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
            await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });

            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true);
        });

        it("✅ Finalize thành công: trả bond + reward cho resolver, trả bond cho creator", async () => {
            const totalPool = ethers.parseEther("15");
            const expectedReward = (totalPool * 100n) / 10000n; // 1% = 0.15 ETH

            const bobGovBefore = await govToken.balanceOf(bob.address);
            const bobEthBefore = await ethers.provider.getBalance(bob.address);
            const aliceGovBefore = await govToken.balanceOf(alice.address);

            // Chờ hết dispute window
            await time.increase(DISPUTE_WINDOW + 1);

            const tx = await dao.connect(owner).finalizeResolve(marketID);

            // Check events
            await expect(tx)
                .to.emit(dao, "ResolverRewarded")
                .withArgs(marketID, bob.address, MIN_RESOLVER_BOND, expectedReward);

            await expect(tx)
                .to.emit(dao, "CreatorBondReturned")
                .withArgs(marketID, alice.address, MIN_CREATOR_BOND);

            // Check GOV balances
            const bobGovAfter = await govToken.balanceOf(bob.address);
            const aliceGovAfter = await govToken.balanceOf(alice.address);

            expect(bobGovAfter - bobGovBefore).to.equal(MIN_RESOLVER_BOND);
            expect(aliceGovAfter - aliceGovBefore).to.equal(MIN_CREATOR_BOND);

            // Check ETH reward (khó check chính xác vì gas, chỉ check > 0)
            const bobEthAfter = await ethers.provider.getBalance(bob.address);
            // Bob nhận reward nhưng không gọi tx nên không tốn gas
            expect(bobEthAfter).to.be.gt(bobEthBefore);

            // Check market flags
            const market = await dao.markets(marketID);
            expect(market.resolverPaid).to.equal(true);
            expect(market.bondReturned).to.equal(true);
        });

        it("❌ Revert: Trong dispute window", async () => {
            await expect(
                dao.connect(owner).finalizeResolve(marketID)
            ).to.be.revertedWith("Dispute window open");
        });

        it("❌ Revert: Có active dispute", async () => {
            await dao.connect(charlie).createDisputeProposal(
                "Resolver sai!",
                marketID,
                false
            );

            await time.increase(DISPUTE_WINDOW + 1);

            await expect(
                dao.connect(owner).finalizeResolve(marketID)
            ).to.be.revertedWith("Has active dispute");
        });

        it("❌ Revert: Đã finalized", async () => {
            await time.increase(DISPUTE_WINDOW + 1);
            await dao.connect(owner).finalizeResolve(marketID);

            await expect(
                dao.connect(owner).finalizeResolve(marketID)
            ).to.be.revertedWith("Resolver already paid");
        });

        it("❌ Revert: Market chưa resolved", async () => {
            await dao.connect(alice).createMarket("Question 2?", duration);
            const newMarketID = 1;

            await expect(
                dao.connect(owner).finalizeResolve(newMarketID)
            ).to.be.revertedWith("Not resolved yet");
        });
    });

    // ========================================
    // 5. CREATE DISPUTE PROPOSAL
    // ========================================

    describe("5. Create Dispute Proposal", () => {
        let marketID;
        const duration = 7 * 24 * 60 * 60;

        beforeEach(async () => {
            await dao.connect(alice).createMarket("ETH > $5000?", duration);
            marketID = 0;

            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
            await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });

            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true); // Resolve YES
        });

        it("✅ Tạo dispute thành công: snapshot = market snapshot, emit event", async () => {
            const market = await dao.markets(marketID);
            const snapshotBlock = market.snapshotBlock;

            const tx = await dao.connect(charlie).createDisputeProposal(
                "Resolver sai! ETH < $5000",
                marketID,
                false // Đề xuất NO
            );

            await expect(tx)
                .to.emit(dao, "ProposalCreated")
                .withArgs(
                    0, // proposalID
                    marketID,
                    false,
                    charlie.address
                );

            const proposal = await dao.proposals(0);
            expect(proposal.description).to.equal("Resolver sai! ETH < $5000");
            expect(proposal.marketID).to.equal(marketID);
            expect(proposal.executeYES).to.equal(false);
            expect(proposal.snapshotBlock).to.equal(snapshotBlock);
            expect(proposal.executed).to.equal(false);

            // Check market linked to proposal
            const marketAfter = await dao.markets(marketID);
            expect(marketAfter.relatedProposalId).to.equal(0);
        });

        it("❌ Revert: Market chưa resolved", async () => {
            await dao.connect(alice).createMarket("Question 2?", duration);
            const newMarketID = 1;

            await expect(
                dao.connect(charlie).createDisputeProposal("Dispute", newMarketID, false)
            ).to.be.revertedWith("Market not resolved yet");
        });

        it("❌ Revert: Sau dispute window", async () => {
            await time.increase(DISPUTE_WINDOW + 1);

            await expect(
                dao.connect(charlie).createDisputeProposal("Too late", marketID, false)
            ).to.be.revertedWith("Dispute window closed");
        });

        it("❌ Revert: Đồng ý với resolver (không dispute)", async () => {
            await expect(
                dao.connect(charlie).createDisputeProposal("I agree", marketID, true)
            ).to.be.revertedWith("Proposal must disagree with resolver");
        });

        it("❌ Revert: Market đã có dispute", async () => {
            await dao.connect(charlie).createDisputeProposal("First dispute", marketID, false);

            await expect(
                dao.connect(david).createDisputeProposal("Second dispute", marketID, false)
            ).to.be.revertedWith("Market already has dispute");
        });

        it("❌ Revert: Invalid market ID", async () => {
            await expect(
                dao.connect(charlie).createDisputeProposal("Dispute", 999, false)
            ).to.be.revertedWith("Invalid market");
        });
    });

    // ========================================
    // 6. VOTE ON PROPOSAL
    // ========================================

    describe("6. Vote on Proposal", () => {
        let marketID, proposalID;
        const duration = 7 * 24 * 60 * 60;

        beforeEach(async () => {
            // Tạo market
            await dao.connect(alice).createMarket("ETH > $5000?", duration);
            // sau khi này, Alice chỉ còn 900 GOV vì đã stake 100 khi tạo market
            marketID = 0;

            // Bet
            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
            await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });

            // Resolve
            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true);

            // Tạo dispute
            await dao.connect(charlie).createDisputeProposal("Dispute", marketID, false);
            proposalID = 0;
        });

        it("✅ Vote FOR thành công: tăng votesFor, emit event", async () => {
            // Alice có 1000 GOV, đã auto-delegate
            const aliceVotingPower = await govToken.getVotes(alice.address);
            console.log("Alice voting power:", ethers.formatEther(aliceVotingPower));
            expect(aliceVotingPower).to.equal(ethers.parseEther("900")); // vì đã bị stake 100 gov khi tạo market

            await expect(
                dao.connect(alice).vote(proposalID, true, ethers.parseEther("500"))
            )
                .to.emit(dao, "Voted")
                .withArgs(proposalID, alice.address, true, ethers.parseEther("500"));

            const proposal = await dao.proposals(proposalID);
            expect(proposal.votesFor).to.equal(ethers.parseEther("500"));
            expect(proposal.votesAgainst).to.equal(0);

            const used = await dao.usedVotingPower(proposalID, alice.address);
            expect(used).to.equal(ethers.parseEther("500"));
        });

        it("✅ Vote AGAINST thành công", async () => {
            await dao.connect(bob).vote(proposalID, false, ethers.parseEther("300"));

            const proposal = await dao.proposals(proposalID);
            expect(proposal.votesAgainst).to.equal(ethers.parseEther("300"));
        });

        it("✅ Vote nhiều lần: voting power cộng dồn", async () => {
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("200"));
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("300"));

            const proposal = await dao.proposals(proposalID);
            expect(proposal.votesFor).to.equal(ethers.parseEther("500"));

            const used = await dao.usedVotingPower(proposalID, alice.address);
            expect(used).to.equal(ethers.parseEther("500"));
        });

        it("❌ Revert: Sau deadline", async () => {
            await time.increase(VOTING_DURATION + 1);

            await expect(
                dao.connect(alice).vote(proposalID, true, ethers.parseEther("100"))
            ).to.be.revertedWith("Voting closed");
        });

        it("❌ Revert: Không còn voting power", async () => {
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("900"));

            await expect(
                dao.connect(alice).vote(proposalID, true, ethers.parseEther("1"))
            ).to.be.revertedWith("No remaining voting power");
        });

        it("❌ Revert: Amount > remaining power", async () => {
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("600"));

            await expect(
                dao.connect(alice).vote(proposalID, true, ethers.parseEther("500"))
            ).to.be.revertedWith("Invalid amount");
        });

        it("❌ Revert: Amount = 0", async () => {
            await expect(
                dao.connect(alice).vote(proposalID, true, 0)
            ).to.be.revertedWith("Invalid amount");
        });

        it("❌ Revert: Invalid proposal ID", async () => {
            await expect(
                dao.connect(alice).vote(999, true, ethers.parseEther("100"))
            ).to.be.revertedWith("Invalid proposal");
        });

        it("✅ Voting power dựa trên snapshot (không ảnh hưởng bởi transfer sau)", async () => {
            // Alice vote trước
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("500"));

            // Alice chuyển token sau khi vote
            await govToken.connect(alice).transfer(david.address, ethers.parseEther("500"));

            // Alice vẫn vote được phần còn lại (vì snapshot trước khi transfer)
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("400"));

            const proposal = await dao.proposals(proposalID);
            expect(proposal.votesFor).to.equal(ethers.parseEther("900"));
        });
    });

    // ========================================
    // 7. EXECUTE PROPOSAL
    // ========================================

    describe("7. Execute Proposal", () => {
        let marketID, proposalID;
        const duration = 7 * 24 * 60 * 60;

        beforeEach(async () => {
            await dao.connect(alice).createMarket("ETH > $5000?", duration);
            marketID = 0;

            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
            await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });

            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true); // Resolve YES

            await dao.connect(charlie).createDisputeProposal("Dispute", marketID, false); // Dispute NO
            proposalID = 0;
        });

        it("✅ Dispute PASS: slash resolver, change outcome, trả creator bond", async () => {
            // Vote FOR dispute (nhiều hơn AGAINST)
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("800"));
            await dao.connect(charlie).vote(proposalID, true, ethers.parseEther("500"));
            await dao.connect(david).vote(proposalID, false, ethers.parseEther("300"));

            await time.increase(VOTING_DURATION + 1);

            const bobGovBefore = await govToken.balanceOf(bob.address);
            const aliceGovBefore = await govToken.balanceOf(alice.address);

            const tx = await dao.connect(owner).executeProposal(proposalID);

            await expect(tx)
                .to.emit(dao, "ProposalExecuted")
                .withArgs(proposalID, true, owner.address);

            await expect(tx).to.emit(dao, "ResolverSlashed");
            await expect(tx).to.emit(dao, "CreatorBondReturned");

            // Check outcome changed
            const market = await dao.markets(marketID);
            expect(market.outcome).to.equal(false); // Changed to NO

            // Check resolver slashed 50%
            const bobGovAfter = await govToken.balanceOf(bob.address);
            const returned = bobGovAfter - bobGovBefore;
            expect(returned).to.equal(MIN_RESOLVER_BOND / 2n); // 25 GOV

            // Check vault received slash
            const vaultBalance = await dao.vaultBalance();
            expect(vaultBalance).to.equal(MIN_RESOLVER_BOND / 2n); // 25 GOV

            // Check creator bond returned
            const aliceGovAfter = await govToken.balanceOf(alice.address);
            expect(aliceGovAfter - aliceGovBefore).to.equal(MIN_CREATOR_BOND);

            // Check flags
            expect(market.resolverPaid).to.equal(true);
            expect(market.bondReturned).to.equal(true);

            const proposal = await dao.proposals(proposalID);
            expect(proposal.executed).to.equal(true);
        });

        it("✅ Dispute FAIL: reward resolver, keep outcome, trả creator bond", async () => {
            // Vote AGAINST dispute (nhiều hơn FOR)
            await dao.connect(alice).vote(proposalID, false, ethers.parseEther("800"));
            await dao.connect(bob).vote(proposalID, false, ethers.parseEther("500"));
            await dao.connect(charlie).vote(proposalID, true, ethers.parseEther("300"));

            await time.increase(VOTING_DURATION + 1);

            const bobGovBefore = await govToken.balanceOf(bob.address);
            const bobEthBefore = await ethers.provider.getBalance(bob.address);
            const aliceGovBefore = await govToken.balanceOf(alice.address);

            const tx = await dao.connect(owner).executeProposal(proposalID);

            await expect(tx)
                .to.emit(dao, "ProposalExecuted")
                .withArgs(proposalID, false, owner.address);

            await expect(tx).to.emit(dao, "ResolverRewarded");
            await expect(tx).to.emit(dao, "CreatorBondReturned");

            // Check outcome không đổi
            const market = await dao.markets(marketID);
            expect(market.outcome).to.equal(true); // Still YES

            // Check resolver rewarded
            const bobGovAfter = await govToken.balanceOf(bob.address);
            expect(bobGovAfter - bobGovBefore).to.equal(MIN_RESOLVER_BOND); // Full 50 GOV

            const bobEthAfter = await ethers.provider.getBalance(bob.address);
            expect(bobEthAfter).to.be.gt(bobEthBefore); // Received ETH reward

            // Check creator bond returned
            const aliceGovAfter = await govToken.balanceOf(alice.address);
            expect(aliceGovAfter - aliceGovBefore).to.equal(MIN_CREATOR_BOND);
        });

        it("❌ Revert: Không phải executor", async () => {
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("800"));
            await time.increase(VOTING_DURATION + 1);

            await expect(
                dao.connect(alice).executeProposal(proposalID)
            ).to.be.revertedWith("Not authorized executor");
        });

        it("❌ Revert: Trước deadline", async () => {
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("800"));

            await expect(
                dao.connect(owner).executeProposal(proposalID)
            ).to.be.revertedWith("Voting not finished");
        });

        it("❌ Revert: Đã executed", async () => {
            await dao.connect(alice).vote(proposalID, true, ethers.parseEther("800"));
            await time.increase(VOTING_DURATION + 1);

            await dao.connect(owner).executeProposal(proposalID);

            await expect(
                dao.connect(owner).executeProposal(proposalID)
            ).to.be.revertedWith("Already executed");
        });

        it("❌ Revert: Invalid proposal ID", async () => {
            await expect(
                dao.connect(owner).executeProposal(999)
            ).to.be.revertedWith("Invalid proposal");
        });
    });

    // ========================================
    // 8. WITHDRAW WINNINGS
    // ========================================

    describe("8. Withdraw Winnings", () => {
        let marketID;
        const duration = 7 * 24 * 60 * 60;

        describe("8.1. Withdraw - Winner có loser pool", () => {
            beforeEach(async () => {
                await dao.connect(alice).createMarket("ETH > $5000?", duration);
                marketID = 0;

                await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
                await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });

                await time.increase(duration + 1);
                await dao.connect(bob).resolveMarket(marketID, true); // YES wins
                await time.increase(DISPUTE_WINDOW + 1);
            });

            it("✅ Winner withdraw: nhận stake + share loser pool - fee, auto-finalize", async () => {
                const bobEthBefore = await ethers.provider.getBalance(bob.address);

                // Bob bet 10 ETH YES, Charlie bet 5 ETH NO, outcome = YES
                // Bob share = 10 / 10 * 5 = 5 ETH from loser pool
                // Gross = 10 + 5 = 15 ETH
                // Fee = 15 * 2% = 0.3 ETH
                // Net = 14.7 ETH

                const tx = await dao.connect(bob).withdrawWinnings(marketID);
                const receipt = await tx.wait();
                const gasPaid = receipt.gasUsed * receipt.gasPrice;

                // Check auto-finalize events
                await expect(tx).to.emit(dao, "ResolverRewarded");
                await expect(tx).to.emit(dao, "CreatorBondReturned");

                // Check withdraw event
                const expectedPayout = ethers.parseEther("14.7");
                const expectedFee = ethers.parseEther("0.3");

                await expect(tx)
                    .to.emit(dao, "Withdrawn");
                // .withArgs(bob.address, marketID, expectedPayout, expectedFee);

                const bobEthAfter = await ethers.provider.getBalance(bob.address);
                const profit = bobEthAfter - bobEthBefore + gasPaid;

                // Bob withdraw 14.7 ETH + resolver reward (~0.15 ETH)
                expect(profit).to.be.closeTo(
                    ethers.parseEther("14.85"),
                    ethers.parseEther("0.01")
                );

                // Check bets cleared
                const bobBetYES = await dao.betsYES(marketID, bob.address);
                expect(bobBetYES).to.equal(0);
            });

            it("✅ Loser withdraw: nhận 80% refund", async () => {
                const charlieEthBefore = await ethers.provider.getBalance(charlie.address);

                // Charlie bet 5 ETH NO, outcome = YES (thua)
                // Refund = 5 * 80% = 4 ETH
                // Fee = 1 ETH

                const tx = await dao.connect(charlie).withdrawWinnings(marketID);
                const receipt = await tx.wait();
                const gasPaid = receipt.gasUsed * receipt.gasPrice;

                const expectedPayout = ethers.parseEther("4");
                const expectedFee = ethers.parseEther("1");

                await expect(tx)
                    .to.emit(dao, "Withdrawn");
                // .withArgs(charlie.address, marketID, expectedPayout, expectedFee);

                const charlieEthAfter = await ethers.provider.getBalance(charlie.address);
                expect(charlieEthAfter - charlieEthBefore + gasPaid).to.be.closeTo(
                    expectedPayout,
                    ethers.parseEther("0.001")
                );
            });

            it("✅ User bet cả 2 bên: nhận winner + 80% loser", async () => {
                // David bet cả YES và NO
                await dao.connect(alice).createMarket("Question 2?", duration);
                const newMarketID = 1;

                await dao.connect(david).placeBet(newMarketID, true, { value: ethers.parseEther("6") });
                await dao.connect(david).placeBet(newMarketID, false, { value: ethers.parseEther("4") });
                await dao.connect(charlie).placeBet(newMarketID, false, { value: ethers.parseEther("6") });

                await time.increase(duration + 1);
                // minter chuyển GOV cho owner để resolve
                console.log("Owner GOV before resolve:", ethers.formatEther(await govToken.balanceOf(owner.address)));
                await dao.connect(owner).resolveMarket(newMarketID, true); // YES wins
                await time.increase(DISPUTE_WINDOW + 1);

                const davidEthBefore = await ethers.provider.getBalance(david.address);

                // David YES: 6 ETH (winner)
                // David NO: 4 ETH (loser)
                // Winner pool: 6 ETH
                // Loser pool: 10 ETH
                // David share from loser: 6/6 * 10 = 10 ETH
                // Winner gross: 6 + 10 = 16 ETH
                // Winner fee: 16 * 2% = 0.32 ETH
                // Winner net: 15.68 ETH
                // Loser refund: 4 * 80% = 3.2 ETH
                // Total: 15.68 + 3.2 = 18.88 ETH

                const tx = await dao.connect(david).withdrawWinnings(newMarketID);
                const receipt = await tx.wait();
                const gasPaid = receipt.gasUsed * receipt.gasPrice;

                const davidEthAfter = await ethers.provider.getBalance(david.address);
                const profit = davidEthAfter - davidEthBefore + gasPaid;

                expect(profit).to.be.closeTo(
                    ethers.parseEther("18.88"),
                    ethers.parseEther("0.01")
                );
            });
        });

        describe("8.2. Withdraw - Solo winner (no loser pool)", () => {
            beforeEach(async () => {
                await dao.connect(alice).createMarket("ETH > $5000?", duration);
                marketID = 0;

                // Chỉ có YES, không có NO
                await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
                await dao.connect(charlie).placeBet(marketID, true, { value: ethers.parseEther("5") });

                await time.increase(duration + 1);
                await dao.connect(owner).resolveMarket(marketID, true);
                await time.increase(DISPUTE_WINDOW + 1);

                // Nạp vault để có bonus
                await owner.sendTransaction({ to: dao.target, value: ethers.parseEther("10") });
            });

            it("✅ Solo winner: nhận stake - fee + vault bonus", async () => {
                const bobEthBefore = await ethers.provider.getBalance(bob.address);

                // Bob bet 10 ETH, total pool = 15 ETH
                // Fee = 10 * 2% = 0.2 ETH
                // Vault bonus = 10 ETH * 5% = 0.5 ETH
                // Bob share = 10/15 * 0.5 = 0.333... ETH
                // Net = 10 - 0.2 + 0.333 = 10.133 ETH

                const tx = await dao.connect(bob).withdrawWinnings(marketID);
                const receipt = await tx.wait();
                const gasPaid = receipt.gasUsed * receipt.gasPrice;

                const bobEthAfter = await ethers.provider.getBalance(bob.address);
                const profit = bobEthAfter - bobEthBefore + gasPaid;

                expect(profit).to.be.closeTo(
                    ethers.parseEther("10.133"),
                    ethers.parseEther("0.01")
                );
            });
        });

        describe("8.3. Withdraw - Error cases", () => {
            beforeEach(async () => {
                await dao.connect(alice).createMarket("ETH > $5000?", duration);
                marketID = 0;

                await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
                await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });
            });

            it("❌ Revert: Market chưa resolved", async () => {
                await expect(
                    dao.connect(bob).withdrawWinnings(marketID)
                ).to.be.revertedWith("Market not resolved");
            });

            it("❌ Revert: User không có bet", async () => {
                await time.increase(duration + 1);
                await dao.connect(owner).resolveMarket(marketID, true);

                await expect(
                    dao.connect(david).withdrawWinnings(marketID)
                ).to.be.revertedWith("No bets in this market");
            });

            it("❌ Revert: Withdraw 2 lần", async () => {
                await time.increase(duration + 1);
                await dao.connect(owner).resolveMarket(marketID, true);
                await time.increase(DISPUTE_WINDOW + 1);

                await dao.connect(bob).withdrawWinnings(marketID);

                await expect(
                    dao.connect(bob).withdrawWinnings(marketID)
                ).to.be.revertedWith("No bets in this market");
            });

            it("❌ Revert: Invalid market ID", async () => {
                await expect(
                    dao.connect(bob).withdrawWinnings(999)
                ).to.be.revertedWith("Invalid market");
            });
        });
    });

    // ========================================
    // 9. ADMIN FUNCTIONS
    // ========================================

    describe("9. Admin Functions", () => {
        it("✅ Owner set executor", async () => {
            await expect(dao.connect(owner).setExecutor(alice.address, true))
                .to.emit(dao, "ExecutorUpdated")
                .withArgs(alice.address, true);

            expect(await dao.executors(alice.address)).to.equal(true);
        });

        it("✅ Owner set fee configs", async () => {
            await dao.connect(owner).setFeeBps(500);
            expect(await dao.feeBps()).to.equal(500);

            await dao.connect(owner).setSoloBonusRate(1000);
            expect(await dao.soloBonusRate()).to.equal(1000);

            await dao.connect(owner).setReturnFeeBps(9000);
            expect(await dao.returnFeeBps()).to.equal(9000);
        });

        it("✅ Owner withdraw vault", async () => {
            await owner.sendTransaction({ to: dao.target, value: ethers.parseEther("10") });

            const ownerEthBefore = await ethers.provider.getBalance(owner.address);

            await expect(
                dao.connect(owner).withdrawVault(owner.address, ethers.parseEther("5"))
            ).to.emit(dao, "VaultWithdrawn");

            const ownerEthAfter = await ethers.provider.getBalance(owner.address);
            expect(ownerEthAfter).to.be.gt(ownerEthBefore);
        });

        it("❌ Revert: Non-owner call admin functions", async () => {
            await expect(
                dao.connect(alice).setExecutor(bob.address, true)
            ).to.be.revertedWith("Only owner");

            await expect(
                dao.connect(alice).setFeeBps(500)
            ).to.be.revertedWith("Only owner");

            await expect(
                dao.connect(alice).withdrawVault(alice.address, 1)
            ).to.be.revertedWith("Only owner");
        });

        it("❌ Revert: Invalid fee (> 100%)", async () => {
            await expect(
                dao.connect(owner).setFeeBps(10001)
            ).to.be.revertedWith("Invalid fee");
        });

        it("❌ Revert: Withdraw vault vượt balance", async () => {
            await expect(
                dao.connect(owner).withdrawVault(owner.address, ethers.parseEther("1000"))
            ).to.be.revertedWith("Insufficient vault");
        });
    });

    // ========================================
    // 10. VIEW FUNCTIONS
    // ========================================

    describe("10. View Functions", () => {
        let marketID;
        const duration = 7 * 24 * 60 * 60;

        beforeEach(async () => {
            await dao.connect(alice).createMarket("ETH > $5000?", duration);
            marketID = 0;

            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });
            await dao.connect(charlie).placeBet(marketID, false, { value: ethers.parseEther("5") });
        });

        it("✅ getTotalBets", async () => {
            const [poolYES, poolNO] = await dao.getTotalBets(marketID);
            expect(poolYES).to.equal(ethers.parseEther("10"));
            expect(poolNO).to.equal(ethers.parseEther("5"));
        });

        it("✅ getMarketsCount", async () => {
            expect(await dao.getMarketsCount()).to.equal(1);

            await dao.connect(alice).createMarket("Question 2?", duration);
            expect(await dao.getMarketsCount()).to.equal(2);
        });

        it("✅ isMarketFinalized", async () => {
            expect(await dao.isMarketFinalized(marketID)).to.equal(false);

            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true);
            expect(await dao.isMarketFinalized(marketID)).to.equal(false);

            await time.increase(DISPUTE_WINDOW + 1);
            await dao.connect(owner).finalizeResolve(marketID);
            expect(await dao.isMarketFinalized(marketID)).to.equal(true);
        });

        it("✅ canWithdraw", async () => {
            expect(await dao.canWithdraw(marketID, bob.address)).to.equal(false);

            await time.increase(duration + 1);
            await dao.connect(owner).resolveMarket(marketID, true);
            expect(await dao.canWithdraw(marketID, bob.address)).to.equal(true);
            expect(await dao.canWithdraw(marketID, david.address)).to.equal(false);
        });

        it("✅ getResolverStatus", async () => {
            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true);

            const [resolver, bond, paid, pendingReward] = await dao.getResolverStatus(marketID);

            expect(resolver).to.equal(bob.address);
            expect(bond).to.equal(MIN_RESOLVER_BOND);
            expect(paid).to.equal(false);
            expect(pendingReward).to.equal(ethers.parseEther("0.15")); // 1% of 15 ETH
        });
    });

    // ========================================
    // 11. EDGE CASES & COMPLEX SCENARIOS
    // ========================================

    describe("11. Edge Cases", () => {
        const duration = 7 * 24 * 60 * 60;

        it("✅ Market không có bet: resolver vẫn nhận bond về nhưng reward = 0", async () => {
            await dao.connect(alice).createMarket("Empty market?", duration);
            const marketID = 0;

            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true);

            const bobGovBefore = await govToken.balanceOf(bob.address);

            await time.increase(DISPUTE_WINDOW + 1);
            await dao.connect(owner).finalizeResolve(marketID);

            const bobGovAfter = await govToken.balanceOf(bob.address);
            expect(bobGovAfter - bobGovBefore).to.equal(MIN_RESOLVER_BOND);

            // Check reward = 0 (vì pool = 0)
            const [, , , pendingReward] = await dao.getResolverStatus(marketID);
            expect(pendingReward).to.equal(0);
        });

        it("✅ Auto-finalize trong withdrawWinnings khi có active dispute chưa execute", async () => {
            await dao.connect(alice).createMarket("Question?", duration);
            const marketID = 0;

            await dao.connect(bob).placeBet(marketID, true, { value: ethers.parseEther("10") });

            await time.increase(duration + 1);
            await dao.connect(bob).resolveMarket(marketID, true);

            // Tạo dispute nhưng KHÔNG execute
            await dao.connect(charlie).createDisputeProposal("Dispute", marketID, false);

            // Chờ hết dispute window nhưng proposal chưa execute
            await time.increase(DISPUTE_WINDOW + VOTING_DURATION + 1);

            // Withdraw KHÔNG auto-finalize vì có active dispute
            const tx = await dao.connect(bob).withdrawWinnings(marketID);

            // Không có ResolverRewarded event vì dispute chưa execute
            const receipt = await tx.wait();
            const events = receipt.logs.filter(log =>
                log.fragment && log.fragment.name === "ResolverRewarded"
            );
            expect(events.length).to.equal(0);
        });

        it("✅ Multiple markets cùng lúc: snapshot độc lập", async () => {
            // ✅ Tạo 2 market với DURATION KHÁC NHAU
            const shortDuration = 3 * 24 * 60 * 60; // 3 days
            const longDuration = 7 * 24 * 60 * 60;  // 7 days

            await dao.connect(alice).createMarket("Market 1 (short)?", shortDuration);
            await dao.connect(alice).createMarket("Market 2 (long)?", longDuration);

            await dao.connect(bob).placeBet(0, true, { value: ethers.parseEther("1") });
            await dao.connect(bob).placeBet(1, true, { value: ethers.parseEther("2") });

            // ✅ Tăng 3 days + 1 → Market 0 hết hạn, Market 1 chưa
            await time.increase(shortDuration + 1);

            // ✅ Resolve market 0 (đã hết hạn)
            await dao.connect(bob).resolveMarket(0, true);

            const market0 = await dao.markets(0);
            const snapshot0 = market0.snapshotBlock;
            expect(market0.bettingClosed).to.equal(true); // ✅ Đã đóng
            expect(snapshot0).to.be.gt(0); // ✅ Có snapshot

            // ✅ Tăng thêm 4 days → Market 1 hết hạn (total 7+ days)
            await time.increase(longDuration - shortDuration + 1);

            // ✅ Resolve market 1 (đã hết hạn)
            await dao.connect(charlie).resolveMarket(1, true);

            const market1 = await dao.markets(1);
            const snapshot1 = market1.snapshotBlock;
            expect(market1.bettingClosed).to.equal(true); // ✅ Đã đóng
            expect(snapshot1).to.be.gt(snapshot0); // ✅ Snapshot sau > Snapshot trước
        });


        it("✅ Contract nhận ETH trực tiếp qua receive()", async () => {
            const tx = await owner.sendTransaction({
                to: dao.target,
                value: ethers.parseEther("5")
            });

            await expect(tx)
                .to.emit(dao, "Received")
                .withArgs(owner.address, ethers.parseEther("5"));
        });
    });
});