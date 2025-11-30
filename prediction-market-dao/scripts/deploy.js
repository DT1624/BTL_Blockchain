const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying with:", deployer.address);

    // initial supply in tokens (as whole units), can override with env INITIAL_SUPPLY
    const initialSupply = "10000";
    const supply = hre.ethers.parseEther(initialSupply);

    const DAO = await hre.ethers.getContractFactory("contracts/PredictionMarketDAO.sol:PredictionMarketDAO");
    const dao = await DAO.deploy(supply);
    // wait for deployment (support both ethers v5/v6 helpers)
    if (dao.waitForDeployment) {
        await dao.waitForDeployment();
    } else {
        await dao.deployed();
    }

    const daoAddress = dao.target || dao.address;
    console.log("PredictionMarketDAO deployed to:", daoAddress);

    const govAddr = await dao.govToken();
    const GOV = await hre.ethers.getContractAt("contracts/GovernanceToken.sol:GovernanceToken", govAddr);
    console.log("GovernanceToken deployed to:", govAddr);


    try {
        const grantAmount = hre.ethers.parseEther("1"); // 1 GOV (BigInt)

        const daoBal = await GOV.balanceOf(daoAddress); // returns BigInt in ethers v6
        // compare BigInt values directly (no .gte())
        if (daoBal >= grantAmount) {
            const networkName = hre.network.name;
            if (networkName === "localhost" || networkName === "hardhat") {
                console.log("Impersonating DAO to transfer GOV -> deployer (local only)...");
                // ensure impersonated account has ETH for gas
                await hre.network.provider.request({
                    method: "hardhat_setBalance",
                    params: [daoAddress, "0xDE0B6B3A7640000"], // 10 ETH
                });
                await hre.network.provider.request({
                    method: "hardhat_impersonateAccount",
                    params: [daoAddress],
                });

                const daoSigner = await hre.ethers.getSigner(daoAddress);
                const govAsDao = GOV.connect(daoSigner);
                const tx = await govAsDao.transfer(deployer.address, grantAmount);
                await tx.wait();
                await hre.network.provider.request({
                    method: "hardhat_stopImpersonatingAccount",
                    params: [daoAddress],
                });
                console.log(`Transferred ${hre.ethers.formatEther(grantAmount)} GOV to deployer`);
            } else {
                const deployerBal = await GOV.balanceOf(deployer.address);
                if (deployerBal >= grantAmount) {
                    console.log("Deployer already has GOV balance; skipping transfer.");
                } else {
                    console.log("DAO holds GOV but cannot impersonate on this network.");
                    console.log("Consider minting or transferring tokens to deployer at token deployment.");
                }
            }
        } else {
            console.log("DAO does not hold enough GOV to grant deployer.");
        }

        const accounts = await hre.ethers.getSigners();
        const provider = hre.ethers.provider;
        for (const signer of accounts) {
            try {
                const addr = await signer.getAddress();
                const bal = await GOV.balanceOf(addr);
                const ethBal = await provider.getBalance(addr);
                const formatted = hre.ethers.formatUnits(bal, 18);
                const ethFormatted = hre.ethers.formatEther(ethBal);
                console.log(`${addr}  —  ${formatted} GOV  —  ${ethFormatted} ETH`);
            } catch (e) {
                console.log(`${signer}  —  error reading balance: ${e.message || e}`);
            }
        }
    } catch (err) {
        console.log("Skipping GOV grant (gov token not found or error):", err.message || err);
    }

    // write frontend .env if frontend folder exists
    const frontendEnvPath = path.join(__dirname, "..", "frontend", ".env");
    if (fs.existsSync(path.dirname(frontendEnvPath))) {
        // const content = `VITE_CONTRACT_ADDRESS=${daoAddress}\n`;
        const content = `VITE_DAO_ADDRESS=${daoAddress}\nVITE_GOV_ADDRESS=${govAddr}`;
        fs.writeFileSync(frontendEnvPath, content, "utf8");
        console.log("Wrote frontend .env ->", frontendEnvPath);
    } else {
        console.log("Frontend folder not found; skipping .env write");
    }

    console.log("Done.");
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });