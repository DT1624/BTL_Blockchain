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

    // Setup initial distribution (optional)
    const [owner, alice, bob, charlie] = await hre.ethers.getSigners();

    const govToken = await hre.ethers.getContractAt("GovernanceToken", govTokenAddress);
    await hre.network.provider.send("hardhat_setBalance", [
        daoAddress,
        "0x56BC75E2D63100000", // 100 ETH in hex
    ]);
    console.log("💰 Distributing GOV tokens...");

    await ethers.provider.send("hardhat_impersonateAccount", [daoAddress]);
    const daoSigner = await ethers.getSigner(daoAddress);
    // Transfer GOV to test accounts
    await govToken.connect(daoSigner).transfer(alice.address, hre.ethers.parseEther("1000"));
    await govToken.connect(daoSigner).transfer(bob.address, hre.ethers.parseEther("1000"));
    await govToken.connect(daoSigner).transfer(charlie.address, hre.ethers.parseEther("1000"));
    console.log("✅ Alice:", hre.ethers.formatEther(await govToken.balanceOf(alice.address)), "GOV");
    console.log("✅ Bob:", hre.ethers.formatEther(await govToken.balanceOf(bob.address)), "GOV");
    console.log("✅ Charlie:", hre.ethers.formatEther(await govToken.balanceOf(charlie.address)), "GOV");

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