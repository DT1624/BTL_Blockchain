const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("🚀 Deploying contracts...\n");

    // Deploy DAO (tự động deploy GovernanceToken)
    const INITIAL_SUPPLY = hre.ethers.parseEther("10000000"); // 10M GOV

    const PredictionMarketDAO = await hre.ethers.getContractFactory("PredictionMarketDAO");
    const dao = await PredictionMarketDAO.deploy(INITIAL_SUPPLY);
    await dao.waitForDeployment();

    const daoAddress = await dao.getAddress();
    const govTokenAddress = await dao.govToken();

    console.log("✅ PredictionMarketDAO deployed to:", daoAddress);
    console.log("✅ GovernanceToken deployed to:", govTokenAddress);

    // Get contracts
    await hre.network.provider.send("hardhat_setBalance", [
        daoAddress,
        "0x56BC75E2D63100000", // 100 ETH in hex
    ]);
    console.log("💰 Distributing GOV tokens...");
    const govToken = await hre.ethers.getContractAt("GovernanceToken", govTokenAddress);
    const [owner, alice, bob, charlie] = await hre.ethers.getSigners();
    await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
    const daoSigner = await ethers.getSigner(daoAddress);

    // Owner balance
    const ownerGovBalance = await govToken.balanceOf(owner.address);
    const ownerEthBalance = await hre.ethers.provider.getBalance(owner.address);

    // DAO contract balance
    const daoGovBalance = await govToken.balanceOf(daoAddress);
    const daoEthBalance = await hre.ethers.provider.getBalance(daoAddress);

    // GovernanceToken contract balance
    const govContractGovBalance = await govToken.balanceOf(govTokenAddress);
    const govContractEthBalance = await hre.ethers.provider.getBalance(govTokenAddress);

    // ========================================
    // 💧 ADD LIQUIDITY TO GOV TOKEN CONTRACT
    // ========================================
    console.log("\n💧 ADDING LIQUIDITY TO GOV TOKEN CONTRACT...");
    
    const liquidityAmount = hre.ethers.parseEther("8000000"); // 8M GOV
    const ethLiquidity = hre.ethers.parseEther("1000"); // 1000 ETH

    // Transfer GOV tokens to contract
    console.log("  Transferring", hre.ethers.formatEther(liquidityAmount), "GOV to contract...");
    const transferTx = await govToken.connect(daoSigner).transfer(govTokenAddress, liquidityAmount);
    await transferTx.wait();

    // Send ETH to contract
    console.log("  Sending", hre.ethers.formatEther(ethLiquidity), "ETH to contract...");
    const fundTx = await owner.sendTransaction({
        to: govTokenAddress,
        value: ethLiquidity,
    });
    await fundTx.wait();

    console.log("✅ Liquidity added!");

    // ========================================
    // 📊 CHECK BALANCES AFTER LIQUIDITY
    // ========================================
    console.log("\n📊 BALANCES AFTER ADDING LIQUIDITY:");
    console.log("=" .repeat(60));

    const ownerGovBalanceAfter = await govToken.balanceOf(owner.address);
    const ownerEthBalanceAfter = await hre.ethers.provider.getBalance(owner.address);
    console.log("\n👑 OWNER:", owner.address);
    console.log("  GOV:", hre.ethers.formatEther(ownerGovBalanceAfter), 
        `(${ownerGovBalance > ownerGovBalanceAfter ? '-' : '+'}${hre.ethers.formatEther(ownerGovBalance - ownerGovBalanceAfter)})`);
    console.log("  ETH:", hre.ethers.formatEther(ownerEthBalanceAfter));

    const govContractGovBalanceAfter = await govToken.balanceOf(govTokenAddress);
    const govContractEthBalanceAfter = await hre.ethers.provider.getBalance(govTokenAddress);
    console.log("\n💰 GOV TOKEN CONTRACT:", govTokenAddress);
    console.log("  GOV:", hre.ethers.formatEther(govContractGovBalanceAfter), 
        `(+${hre.ethers.formatEther(govContractGovBalanceAfter - govContractGovBalance)})`);
    console.log("  ETH:", hre.ethers.formatEther(govContractEthBalanceAfter), 
        `(+${hre.ethers.formatEther(govContractEthBalanceAfter - govContractEthBalance)})`);

    console.log("=" .repeat(60));

    // ========================================
    // 📊 FINAL BALANCES
    // ========================================
    console.log("\n📊 FINAL BALANCES:");
    console.log("=" .repeat(60));

    const ownerGovFinal = await govToken.balanceOf(owner.address);
    const ownerEthFinal = await hre.ethers.provider.getBalance(owner.address);
    console.log("\n👑 OWNER:", owner.address);
    console.log("  GOV:", hre.ethers.formatEther(ownerGovFinal));
    console.log("  ETH:", hre.ethers.formatEther(ownerEthFinal));

    const govContractGovFinal = await govToken.balanceOf(govTokenAddress);
    const govContractEthFinal = await hre.ethers.provider.getBalance(govTokenAddress);
    console.log("\n💰 GOV TOKEN CONTRACT:", govTokenAddress);
    console.log("  GOV:", hre.ethers.formatEther(govContractGovFinal));
    console.log("  ETH:", hre.ethers.formatEther(govContractEthFinal));

    const daoGovFinal = await govToken.balanceOf(daoAddress);
    const daoEthFinal = await hre.ethers.provider.getBalance(daoAddress);
    console.log("\n🏛️  DAO CONTRACT:", daoAddress);
    console.log("  GOV:", hre.ethers.formatEther(daoGovFinal));
    console.log("  ETH:", hre.ethers.formatEther(daoEthFinal));

    console.log("\n📈 TOTAL SUPPLY:", hre.ethers.formatEther(await govToken.totalSupply()));
    console.log("=" .repeat(60));

    // Save addresses to frontend
    const addresses = {
        localhost: {
            DAO_ADDRESS: daoAddress,
            GOV_TOKEN_ADDRESS: govTokenAddress,
        },
    };

    const configPath = path.join(__dirname, "../frontend/src/utils/contract.js");
    let configContent = fs.readFileSync(configPath, "utf8");

    // Update DAO_ADDRESS
    configContent = configContent.replace(
        /DAO_ADDRESS: ['"].*?['"]/,
        `DAO_ADDRESS: '${daoAddress}'`
    );

    fs.writeFileSync(configPath, configContent);
    console.log("✅ Updated contract addresses in frontend\n");

    console.log("\n🎉 Deployment completed!");
    console.log("\n📋 Summary:");
    console.log("DAO Address:", daoAddress);
    console.log("GOV Token Address:", govTokenAddress);
    console.log("\n🌐 Start frontend:");
    console.log("cd frontend && npm start");

    const frontendEnvPath = path.join(__dirname, "..", "frontend", ".env");
    if (fs.existsSync(path.dirname(frontendEnvPath))) {
        // const content = `VITE_CONTRACT_ADDRESS=${daoAddress}\n`;
        const content = `VITE_DAO_ADDRESS=${daoAddress}\nVITE_GOV_ADDRESS=${govTokenAddress}`;
        fs.writeFileSync(frontendEnvPath, content, "utf8");
        console.log("Wrote frontend .env ->", frontendEnvPath);
    } else {
        console.log("Frontend folder not found; skipping .env write");
    }

    console.log("Done.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });